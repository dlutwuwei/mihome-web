import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

/** 开放 API 的授权范围。 */
export type ApiKeyScope = "devices:read" | "devices:live" | "devices:control";

export const API_KEY_SCOPES: ApiKeyScope[] = ["devices:read", "devices:live", "devices:control"];

/** 对外展示用的 Key 信息，不包含明文。 */
export interface ApiKeyRow {
  id: string;
  /** 明文 Key 的前 8 位，用于界面辨认。 */
  prefix: string;
  name: string;
  scopes: ApiKeyScope[];
  createdAt: number;
  /** 0 表示永不过期。 */
  expiresAt: number;
  enabled: boolean;
  lastUsedAt: number;
  lastUsedPath: string;
  requestCount: number;
}

interface KeyRecord {
  hub_id: string;
  id: string;
  prefix: string;
  secret_hash: string;
  name: string;
  scopes: string;
  created_at: number;
  expires_at: number;
  enabled: number;
  last_used_at: number;
  last_used_path: string;
  request_count: number;
}

interface AuditRecord {
  time: number;
  hub_id: string;
  key_id: string;
  key_name: string;
  method: string;
  path: string;
  status: number;
  ms: number;
  ip: string;
  message: string | null;
  unattributed: number;
}

interface LegacyStore {
  hubs?: Array<{
    id?: string;
    keys?: Array<Partial<ApiKeyRow> & { secretHash?: string }>;
  }>;
  audit?: AuditEntry[];
}

/** 校验通过后挂在 req 上的调用上下文。 */
export interface AuthContext {
  hubId: string;
  keyId: string;
  keyName: string;
  scopes: ApiKeyScope[];
}

/** 一次开放 API 请求的审计记录。鉴权失败的请求 keyId 为空。 */
export interface AuditEntry {
  time: number;
  hubId: string;
  keyId: string;
  keyName: string;
  method: string;
  path: string;
  status: number;
  ms: number;
  ip: string;
  /** 失败时的错误信息摘要。 */
  message?: string;
  /** 鉴权失败且无法定位归属的记录仅保留在服务端，不分发给任何 hub。 */
  unattributed?: boolean;
}

const AUDIT_LIMIT = 5000;
const AUTH_FAILURE_LIMIT = 20;
const AUTH_FAILURE_WINDOW_MS = 30 * 1000;
const recentFailures = new Map<string, { count: number; until: number }>();

const defaultDataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data");
const dataDir = process.env.MIHOME_DATA_DIR ? path.resolve(process.env.MIHOME_DATA_DIR) : defaultDataDir;
const databasePath = path.join(dataDir, "mihome.db");
const legacyStorePath = path.join(dataDir, "api-keys.json");

fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const db = new DatabaseSync(databasePath);
fs.chmodSync(databasePath, 0o600);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA synchronous = NORMAL");
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA busy_timeout = 5000");
db.exec(`
  CREATE TABLE IF NOT EXISTS app_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    hub_id TEXT NOT NULL,
    id TEXT NOT NULL,
    prefix TEXT NOT NULL,
    secret_hash TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    scopes TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_used_at INTEGER NOT NULL DEFAULT 0,
    last_used_path TEXT NOT NULL DEFAULT '',
    request_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (hub_id, id)
  );

  CREATE INDEX IF NOT EXISTS idx_api_keys_hub_created
    ON api_keys (hub_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS audit_entries (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    time INTEGER NOT NULL,
    hub_id TEXT NOT NULL,
    key_id TEXT NOT NULL DEFAULT '',
    key_name TEXT NOT NULL DEFAULT '',
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    status INTEGER NOT NULL,
    ms INTEGER NOT NULL,
    ip TEXT NOT NULL DEFAULT '',
    message TEXT,
    unattributed INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_audit_hub_seq
    ON audit_entries (hub_id, seq DESC);

  CREATE INDEX IF NOT EXISTS idx_audit_hub_key_seq
    ON audit_entries (hub_id, key_id, seq DESC);
`);

function hash(secret: string) {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

function parseScopes(value: string): ApiKeyScope[] {
  try {
    const scopes: unknown = JSON.parse(value);
    if (!Array.isArray(scopes)) return [];
    return scopes.filter((scope): scope is ApiKeyScope => API_KEY_SCOPES.includes(scope as ApiKeyScope));
  } catch {
    return [];
  }
}

function transaction<T>(work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function pruneAudit() {
  db.prepare(`
    DELETE FROM audit_entries
    WHERE seq < (
      SELECT seq FROM audit_entries ORDER BY seq DESC LIMIT 1 OFFSET ?
    )
  `).run(AUDIT_LIMIT - 1);
}

/** 首次启动时迁入旧 JSON；失败则不写入完成标记，下次启动可重试。 */
function migrateLegacyStore() {
  const marker = db.prepare("SELECT value FROM app_metadata WHERE key = 'legacy_api_keys_json'").get() as
    | { value: string }
    | undefined;
  if (marker) return;
  if (!fs.existsSync(legacyStorePath)) {
    db.prepare("INSERT INTO app_metadata (key, value) VALUES ('legacy_api_keys_json', 'not-found')").run();
    return;
  }

  try {
    const body = JSON.parse(fs.readFileSync(legacyStorePath, "utf8")) as LegacyStore;
    transaction(() => {
      const insertKey = db.prepare(`
        INSERT OR IGNORE INTO api_keys (
          hub_id, id, prefix, secret_hash, name, scopes, created_at, expires_at,
          enabled, last_used_at, last_used_path, request_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const hub of body.hubs || []) {
        if (!hub.id || !Array.isArray(hub.keys)) continue;
        for (const row of hub.keys) {
          if (typeof row.id !== "string" || typeof row.secretHash !== "string") continue;
          const scopes = Array.isArray(row.scopes)
            ? row.scopes.filter((scope) => API_KEY_SCOPES.includes(scope))
            : [];
          insertKey.run(
            hub.id,
            row.id,
            String(row.prefix || ""),
            row.secretHash,
            String(row.name || ""),
            JSON.stringify(scopes),
            Number(row.createdAt || 0),
            Number(row.expiresAt || 0),
            row.enabled === false ? 0 : 1,
            Number(row.lastUsedAt || 0),
            String(row.lastUsedPath || ""),
            Number(row.requestCount || 0),
          );
        }
      }

      const insertAudit = db.prepare(`
        INSERT INTO audit_entries (
          time, hub_id, key_id, key_name, method, path, status, ms, ip, message, unattributed
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const audit = (body.audit || []).filter((row) => typeof row?.time === "number").slice(0, AUDIT_LIMIT);
      // JSON 按新到旧排列；按相反顺序插入，让自增 seq 与时间顺序一致。
      for (const row of audit.reverse()) {
        insertAudit.run(
          row.time,
          String(row.hubId || ""),
          String(row.keyId || ""),
          String(row.keyName || ""),
          String(row.method || ""),
          String(row.path || ""),
          Number(row.status || 0),
          Number(row.ms || 0),
          String(row.ip || ""),
          row.message == null ? null : String(row.message),
          row.unattributed ? 1 : 0,
        );
      }
      pruneAudit();
      db.prepare("INSERT INTO app_metadata (key, value) VALUES ('legacy_api_keys_json', ?)").run(
        new Date().toISOString(),
      );
    });
  } catch (error) {
    console.error("迁移旧 API Key 数据失败", error instanceof Error ? error.message : "");
  }
}

migrateLegacyStore();

const KEY_COLUMNS = `
  hub_id, id, prefix, secret_hash, name, scopes, created_at, expires_at,
  enabled, last_used_at, last_used_path, request_count
`;
const insertKeyStatement = db.prepare(`
  INSERT INTO api_keys (
    hub_id, id, prefix, secret_hash, name, scopes, created_at, expires_at,
    enabled, last_used_at, last_used_path, request_count
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const listKeysStatement = db.prepare(`
  SELECT ${KEY_COLUMNS} FROM api_keys WHERE hub_id = ? ORDER BY created_at DESC, id DESC
`);
const getKeyStatement = db.prepare(`SELECT ${KEY_COLUMNS} FROM api_keys WHERE hub_id = ? AND id = ?`);
const getKeyByHashStatement = db.prepare(`SELECT ${KEY_COLUMNS} FROM api_keys WHERE secret_hash = ?`);

function publicRow(row: KeyRecord): ApiKeyRow {
  return {
    id: row.id,
    prefix: row.prefix,
    name: row.name,
    scopes: parseScopes(row.scopes),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    enabled: Boolean(row.enabled),
    lastUsedAt: row.last_used_at,
    lastUsedPath: row.last_used_path,
    requestCount: row.request_count,
  };
}

/** 生成一把新 Key。明文只返回这一次，本地仅保存 SHA-256 摘要。 */
export function createApiKey(
  hubId: string,
  name: string,
  scopes: ApiKeyScope[],
  expiresInDays = 0,
): { key: ApiKeyRow; secret: string } {
  const id = crypto.randomBytes(9).toString("hex");
  const secretPart = crypto.randomBytes(24).toString("hex");
  const secret = `mihome_${id}_${secretPart}`;
  const now = Date.now();
  const key: ApiKeyRow = {
    id,
    prefix: `mihome_${id}_${secretPart.slice(0, 8)}`,
    name: name || "未命名",
    scopes: scopes.length ? scopes : ["devices:read"],
    createdAt: now,
    expiresAt: expiresInDays > 0 ? now + expiresInDays * 86400000 : 0,
    enabled: true,
    lastUsedAt: 0,
    lastUsedPath: "",
    requestCount: 0,
  };
  insertKeyStatement.run(
    hubId,
    key.id,
    key.prefix,
    hash(secret),
    key.name,
    JSON.stringify(key.scopes),
    key.createdAt,
    key.expiresAt,
    1,
    0,
    "",
    0,
  );
  return { key, secret };
}

export function listApiKeys(hubId: string): ApiKeyRow[] {
  return (listKeysStatement.all(hubId) as unknown as KeyRecord[]).map(publicRow);
}

export function getApiKey(hubId: string, id: string): ApiKeyRow | null {
  const row = getKeyStatement.get(hubId, id) as unknown as KeyRecord | undefined;
  return row ? publicRow(row) : null;
}

export function setApiKeyEnabled(hubId: string, id: string, enabled: boolean): ApiKeyRow | null {
  const result = db.prepare("UPDATE api_keys SET enabled = ? WHERE hub_id = ? AND id = ?").run(
    enabled ? 1 : 0,
    hubId,
    id,
  );
  return result.changes ? getApiKey(hubId, id) : null;
}

export function revokeApiKey(hubId: string, id: string): boolean {
  return db.prepare("DELETE FROM api_keys WHERE hub_id = ? AND id = ?").run(hubId, id).changes > 0;
}

/** 通过唯一摘要索引查询，命中后再用安全比较确认。 */
export function verifyApiKey(secret: string): AuthContext | null {
  if (!secret) return null;
  const target = hash(secret);
  const row = getKeyByHashStatement.get(target) as unknown as KeyRecord | undefined;
  const now = Date.now();
  if (!row || !row.enabled || (row.expires_at && now > row.expires_at)) return null;
  if (!timingSafeEqualHex(row.secret_hash, target)) return null;
  db.prepare(`
    UPDATE api_keys
    SET last_used_at = ?, request_count = request_count + 1
    WHERE hub_id = ? AND id = ?
  `).run(now, row.hub_id, row.id);
  return { hubId: row.hub_id, keyId: row.id, keyName: row.name, scopes: parseScopes(row.scopes) };
}

function timingSafeEqualHex(left: string, right: string) {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function hasScope(ctx: AuthContext, scope: ApiKeyScope) {
  return ctx.scopes.includes(scope);
}

export function recordAudit(entry: AuditEntry) {
  transaction(() => {
    db.prepare("UPDATE api_keys SET last_used_path = ? WHERE hub_id = ? AND id = ?").run(
      entry.path,
      entry.hubId,
      entry.keyId,
    );
    db.prepare(`
      INSERT INTO audit_entries (
        time, hub_id, key_id, key_name, method, path, status, ms, ip, message, unattributed
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.time,
      entry.hubId,
      entry.keyId,
      entry.keyName,
      entry.method,
      entry.path,
      entry.status,
      entry.ms,
      entry.ip,
      entry.message ?? null,
      entry.unattributed ? 1 : 0,
    );
    pruneAudit();
  });
}

function publicAudit(row: AuditRecord): AuditEntry {
  const entry: AuditEntry = {
    time: row.time,
    hubId: row.hub_id,
    keyId: row.key_id,
    keyName: row.key_name,
    method: row.method,
    path: row.path,
    status: row.status,
    ms: row.ms,
    ip: row.ip,
  };
  if (row.message !== null) entry.message = row.message;
  if (row.unattributed) entry.unattributed = true;
  return entry;
}

export function listAudit(hubId: string, keyId = "", limit = 100): AuditEntry[] {
  const count = Math.max(0, Math.floor(limit));
  if (!count) return [];
  const rows = keyId
    ? db.prepare(`
        SELECT time, hub_id, key_id, key_name, method, path, status, ms, ip, message, unattributed
        FROM audit_entries WHERE hub_id = ? AND key_id = ? ORDER BY seq DESC LIMIT ?
      `).all(hubId, keyId, count)
    : db.prepare(`
        SELECT time, hub_id, key_id, key_name, method, path, status, ms, ip, message, unattributed
        FROM audit_entries WHERE hub_id = ? ORDER BY seq DESC LIMIT ?
      `).all(hubId, count);
  return (rows as unknown as AuditRecord[]).map(publicAudit);
}

export function clearAudit(hubId: string) {
  db.prepare("DELETE FROM audit_entries WHERE hub_id = ?").run(hubId);
}

/** 只检查当前限流状态，不把有效请求计为失败。 */
export function isAuthThrottled(ip: string): boolean {
  const now = Date.now();
  const hit = recentFailures.get(ip);
  if (!hit) return false;
  if (hit.until <= now) {
    recentFailures.delete(ip);
    return false;
  }
  return hit.count >= AUTH_FAILURE_LIMIT;
}

/** 仅在 Key 校验失败后计数，同一 IP 在窗口内失败过多则触发限流。 */
export function recordAuthFailure(ip: string) {
  const now = Date.now();
  const hit = recentFailures.get(ip);
  if (hit && hit.until > now) {
    hit.count += 1;
    return;
  }
  recentFailures.set(ip, { count: 1, until: now + AUTH_FAILURE_WINDOW_MS });
  if (recentFailures.size > 1000) {
    for (const [key, value] of recentFailures) {
      if (value.until <= now) recentFailures.delete(key);
    }
  }
}

export function clearAuthFailures(ip: string) {
  recentFailures.delete(ip);
}
