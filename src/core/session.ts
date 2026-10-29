import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DeviceSummary, PendingAuth, VendorSession } from "../providers/types.js";
import { CookieJar } from "../providers/xiaomi/http.js";

export interface AccountView {
  accountId: string;
  vendorId: string;
  userId: string;
  region: string;
}

interface Hub {
  accounts: Map<string, VendorSession>;
}

const hubs = new Map<string, Hub>();
const pending = new Map<string, PendingAuth>();
const PENDING_TTL_MS = 10 * 60 * 1000;
const storePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/hubs.json");

function encode(value: unknown): unknown {
  if (value == null || typeof value !== "object") return value;
  if (Buffer.isBuffer(value)) return { $buf: value.toString("base64") };
  if (value instanceof Map) return { $map: [...value.entries()].map(([key, item]) => [encode(key), encode(item)]) };
  if (value instanceof CookieJar) return { $jar: Object.fromEntries(value.map) };
  if (Array.isArray(value)) return value.map(encode);
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "password") continue;
    out[key] = encode(item);
  }
  return out;
}

function decode(value: unknown): unknown {
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(decode);
  const row = value as Record<string, unknown>;
  if (typeof row.$buf === "string") return Buffer.from(row.$buf, "base64");
  if (Array.isArray(row.$map)) return new Map(row.$map.map((pair) => {
    const [key, item] = pair as [unknown, unknown];
    return [decode(key), decode(item)];
  }));
  if (row.$jar && typeof row.$jar === "object") {
    const jar = new CookieJar();
    for (const [key, item] of Object.entries(row.$jar as Record<string, unknown>)) {
      if (typeof item === "string") jar.set(key, item);
    }
    return jar;
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(row)) out[key] = decode(item);
  return out;
}

function persist() {
  try {
    writeStore();
  } catch (error) {
    console.error("保存登录态失败", error instanceof Error ? error.message : "");
  }
}

function writeStore() {
  const body = {
    hubs: [...hubs.entries()].map(([id, hub]) => ({
      id,
      accounts: [...hub.accounts.entries()].map(([accountId, session]) => ({
        accountId,
        vendorId: session.vendorId,
        userId: session.userId,
        region: session.region,
        devices: [...session.devices.values()],
        state: encode(session.state),
      })),
    })),
  };
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  const temp = `${storePath}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(body), { mode: 0o600 });
  fs.renameSync(temp, storePath);
}

function restore() {
  if (!fs.existsSync(storePath)) return;
  let body: { hubs?: Array<{ id?: string; accounts?: Array<Record<string, unknown>> }> };
  try {
    body = JSON.parse(fs.readFileSync(storePath, "utf8"));
  } catch {
    return;
  }
  for (const hub of body.hubs || []) {
    if (!hub.id || !Array.isArray(hub.accounts)) continue;
    const accounts = new Map<string, VendorSession>();
    for (const row of hub.accounts) {
      if (typeof row.accountId !== "string" || typeof row.vendorId !== "string") continue;
      const devices = new Map<string, DeviceSummary>();
      if (Array.isArray(row.devices)) {
        for (const device of row.devices as DeviceSummary[]) {
          if (device?.did) devices.set(device.did, device);
        }
      }
      accounts.set(row.accountId, {
        vendorId: row.vendorId,
        userId: String(row.userId || ""),
        region: String(row.region || "cn"),
        devices,
        state: decode(row.state),
      });
    }
    if (accounts.size) hubs.set(hub.id, { accounts });
  }
}

restore();

function views(hub: Hub): AccountView[] {
  return [...hub.accounts.entries()].map(([accountId, session]) => ({
    accountId,
    vendorId: session.vendorId,
    userId: session.userId,
    region: session.region,
  }));
}

export function readHubId(cookieHeader?: string) {
  const raw = cookieHeader || "";
  const hit = raw.split(";").map((part) => part.trim()).find((part) => part.startsWith("hub="));
  return hit ? decodeURIComponent(hit.slice(4)) : "";
}

export function getHub(hubId: string) {
  return hubs.get(hubId) || null;
}

export function listAccounts(hubId: string) {
  const hub = hubs.get(hubId);
  return hub ? views(hub) : [];
}

export function getAccount(hubId: string, accountId: string) {
  return hubs.get(hubId)?.accounts.get(accountId) || null;
}

export function accountsOf(hubId: string) {
  const hub = hubs.get(hubId);
  if (!hub) return [];
  return [...hub.accounts.entries()].map(([accountId, session]) => ({ accountId, session }));
}

/** 同一厂商、同一用户再次登录时替换会话，其它账号保留。 */
export function attachAccount(hubId: string | undefined, session: VendorSession) {
  const id = hubId && hubs.has(hubId) ? hubId : crypto.randomBytes(18).toString("hex");
  let hub = hubs.get(id);
  if (!hub) {
    hub = { accounts: new Map() };
    hubs.set(id, hub);
  }
  let accountId = "";
  for (const [key, current] of hub.accounts) {
    if (current.vendorId === session.vendorId && current.userId === session.userId && current.region === session.region) {
      accountId = key;
      break;
    }
  }
  if (!accountId) accountId = crypto.randomBytes(9).toString("hex");
  hub.accounts.set(accountId, session);
  persist();
  return { hubId: id, accountId, accounts: views(hub) };
}

export function removeAccount(hubId: string, accountId: string) {
  const hub = hubs.get(hubId);
  if (!hub) return [];
  hub.accounts.delete(accountId);
  if (!hub.accounts.size) hubs.delete(hubId);
  persist();
  return hub.accounts.size ? views(hub) : [];
}

export function deleteHub(hubId: string) {
  if (!hubs.delete(hubId)) return;
  persist();
}

export function keepPending(auth: PendingAuth) {
  const id = crypto.randomBytes(18).toString("hex");
  auth.id = id;
  auth.createdAt = Date.now();
  pending.set(id, auth);
  return id;
}

export function takePending(id: string) {
  const row = pending.get(id);
  if (!row || Date.now() - row.createdAt > PENDING_TTL_MS) {
    pending.delete(id);
    return null;
  }
  pending.delete(id);
  return row;
}

export function peekPending(id: string) {
  const row = pending.get(id);
  if (!row || Date.now() - row.createdAt > PENDING_TTL_MS) {
    pending.delete(id);
    return null;
  }
  return row;
}

export function putPending(id: string, auth: PendingAuth) {
  auth.id = id;
  auth.createdAt = Date.now();
  pending.set(id, auth);
}

export function dropPending(id: string) {
  pending.delete(id);
}
