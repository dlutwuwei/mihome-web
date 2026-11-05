import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
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

/** 存储的一份 Key，secretHash 是明文 Key 的 SHA-256。 */
interface StoredKey {
  id: string;
  prefix: string;
  secretHash: string;
  name: string;
  scopes: ApiKeyScope[];
  createdAt: number;
  expiresAt: number;
  enabled: boolean;
  lastUsedAt: number;
  lastUsedPath: string;
  requestCount: number;
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
let flushScheduled = false;

const storePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/api-keys.json");

interface Store {
  hubs: Map<string, Map<string, StoredKey>>;
  audit: AuditEntry[];
}

const store: Store = { hubs: new Map(), audit: [] };
const secretIndex = new Map<string, { hubId: string; row: StoredKey }>();

function hash(secret: string) {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

function writeStore() {
  const body = {
    hubs: [...store.hubs.entries()].map(([hubId, keys]) => ({
      id: hubId,
      keys: [...keys.values()],
    })),
    audit: store.audit,
  };
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  const temp = `${storePath}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(body), { mode: 0o600 });
  fs.renameSync(temp, storePath);
}

function persist() {
  try {
    writeStore();
  } catch (error) {
    console.error("保存 API Key 失败", error instanceof Error ? error.message : "");
  }
}

function restore() {
  if (!fs.existsSync(storePath)) return;
  let body: {
    hubs?: Array<{ id?: string; keys?: Array<Partial<StoredKey>> }>;
    audit?: AuditEntry[];
  };
  try {
    body = JSON.parse(fs.readFileSync(storePath, "utf8"));
  } catch {
    return;
  }
  for (const hub of body.hubs || []) {
    if (!hub.id || !Array.isArray(hub.keys)) continue;
    const keys = new Map<string, StoredKey>();
    for (const row of hub.keys) {
      if (typeof row.id !== "string" || typeof row.secretHash !== "string") continue;
      keys.set(row.id, {
        id: row.id,
        prefix: String(row.prefix || ""),
        secretHash: row.secretHash,
        name: String(row.name || ""),
        scopes: Array.isArray(row.scopes) ? (row.scopes.filter((s) => API_KEY_SCOPES.includes(s as ApiKeyScope)) as ApiKeyScope[]) : [],
        createdAt: Number(row.createdAt || 0),
        expiresAt: Number(row.expiresAt || 0),
        enabled: row.enabled !== false,
        lastUsedAt: Number(row.lastUsedAt || 0),
        lastUsedPath: String(row.lastUsedPath || ""),
        requestCount: Number(row.requestCount || 0),
      });
    }
    if (keys.size) store.hubs.set(hub.id, keys);
  }
  if (Array.isArray(body.audit)) {
    store.audit = body.audit.filter((row) => typeof row?.time === "number").slice(0, AUDIT_LIMIT);
  }
}

restore();
for (const [hubId, keys] of store.hubs) {
  for (const row of keys.values()) secretIndex.set(row.secretHash, { hubId, row });
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
  const row: StoredKey = {
    id,
    prefix: `mihome_${id}_${secretPart.slice(0, 8)}`,
    secretHash: hash(secret),
    name: name || "未命名",
    scopes: scopes.length ? scopes : ["devices:read"],
    createdAt: Date.now(),
    expiresAt: expiresInDays > 0 ? Date.now() + expiresInDays * 86400000 : 0,
    enabled: true,
    lastUsedAt: 0,
    lastUsedPath: "",
    requestCount: 0,
  };
  let keys = store.hubs.get(hubId);
  if (!keys) {
    keys = new Map();
    store.hubs.set(hubId, keys);
  }
  keys.set(row.id, row);
  secretIndex.set(row.secretHash, { hubId, row });
  persist();
  return { key: publicRow(row), secret };
}

function publicRow(row: StoredKey): ApiKeyRow {
  const { secretHash: _secretHash, ...rest } = row;
  return rest;
}

export function listApiKeys(hubId: string): ApiKeyRow[] {
  const keys = store.hubs.get(hubId);
  if (!keys) return [];
  return [...keys.values()].sort((a, b) => b.createdAt - a.createdAt).map(publicRow);
}

export function getApiKey(hubId: string, id: string): ApiKeyRow | null {
  const row = store.hubs.get(hubId)?.get(id);
  return row ? publicRow(row) : null;
}

export function setApiKeyEnabled(hubId: string, id: string, enabled: boolean): ApiKeyRow | null {
  const row = store.hubs.get(hubId)?.get(id);
  if (!row) return null;
  row.enabled = enabled;
  persist();
  return publicRow(row);
}

export function revokeApiKey(hubId: string, id: string): boolean {
  const keys = store.hubs.get(hubId);
  const row = keys?.get(id);
  if (!keys || !row) return false;
  keys.delete(id);
  secretIndex.delete(row.secretHash);
  if (!keys.size) store.hubs.delete(hubId);
  persist();
  return true;
}

/** 通过摘要索引做常量时间复杂度查询，命中后再用安全比较确认。 */
export function verifyApiKey(secret: string): AuthContext | null {
  if (!secret) return null;
  const target = hash(secret);
  const hit = secretIndex.get(target);
  if (!hit || !hit.row.enabled || (hit.row.expiresAt && Date.now() > hit.row.expiresAt)) return null;
  if (!timingSafeEqualHex(hit.row.secretHash, target)) return null;
  const now = Date.now();
  hit.row.lastUsedAt = now;
  hit.row.requestCount += 1;
  return { hubId: hit.hubId, keyId: hit.row.id, keyName: hit.row.name, scopes: [...hit.row.scopes] };
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
  const key = store.hubs.get(entry.hubId)?.get(entry.keyId);
  if (key) key.lastUsedPath = entry.path;
  store.audit.unshift(entry);
  if (store.audit.length > AUDIT_LIMIT) store.audit.length = AUDIT_LIMIT;
  // 审计写入频繁，合并到同一轮事件循环末尾再落盘。
  if (flushScheduled) return;
  flushScheduled = true;
  queueMicrotask(() => {
    flushScheduled = false;
    persist();
  });
}

export function listAudit(hubId: string, keyId = "", limit = 100): AuditEntry[] {
  const rows: AuditEntry[] = [];
  for (const row of store.audit) {
    // keyId 筛选也必须限定 hub，且匿名失败记录不能跨 hub 分发。
    if (row.hubId !== hubId || (keyId && row.keyId !== keyId)) continue;
    rows.push(row);
    if (rows.length >= limit) break;
  }
  return rows;
}

export function clearAudit(hubId: string) {
  store.audit = store.audit.filter((row) => row.hubId !== hubId);
  persist();
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
