import { randomUUID } from "node:crypto";
import { Router } from "express";
import type { AuthContext, ApiKeyScope } from "../core/apikey.js";
import {
  clearAuthFailures,
  hasScope,
  isAuthThrottled,
  recordAudit,
  recordAuthFailure,
  verifyApiKey,
} from "../core/apikey.js";
import { AppError, toPublicError } from "../core/errors.js";
import { getVendor } from "../core/registry.js";
import { accountsOf, getAccount } from "../core/session.js";
import type { DeviceSummary, VendorSession } from "../providers/types.js";

export const openRouter = Router();

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** API Key 校验通过后挂载的调用上下文。 */
      apiAuth?: AuthContext;
      /** 审计里补充的失败原因。 */
      auditMessage?: string;
    }
  }
}

const AUDIT_PATH_MAX = 300;

function bearer(req: import("express").Request) {
  const header = String(req.headers.authorization || "");
  if (header.startsWith("Bearer ")) return header.slice(7).trim();
  return String(req.query.apiKey || "").trim();
}

function clientIp(req: import("express").Request) {
  return req.ip || req.socket.remoteAddress || "";
}

function auditPath(req: import("express").Request) {
  const raw = req.originalUrl || `${req.baseUrl || ""}${req.path || ""}`;
  try {
    const url = new URL(raw, "http://localhost");
    if (url.searchParams.has("apiKey")) url.searchParams.set("apiKey", "[redacted]");
    return `${url.pathname}${url.search}`;
  } catch {
    return raw.replace(/([?&]apiKey=)[^&]*/gi, "$1[redacted]");
  }
}

function truncate(value: string, max = AUDIT_PATH_MAX) {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/**
 * API Key 鉴权 + 请求审计。
 * 每个请求（含鉴权失败的请求）都会写一条审计记录，keyId 为空表示未通过鉴权。
 */
openRouter.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.vary("Authorization");
  const started = Date.now();
  const ip = clientIp(req);
  const secret = bearer(req);
  let ctx: AuthContext | null = null;

  res.on("finish", () => {
    recordAudit({
      time: started,
      hubId: ctx?.hubId || "",
      keyId: ctx?.keyId || "",
      keyName: ctx?.keyName || (secret ? "(无效 Key)" : "(缺少 Key)"),
      method: req.method,
      path: truncate(auditPath(req)),
      status: res.statusCode,
      ms: Date.now() - started,
      ip,
      unattributed: !ctx,
      message: res.statusCode >= 400 ? truncate(req.auditMessage || `HTTP ${res.statusCode}`, 180) : undefined,
    });
  });

  if (!secret) {
    res.status(401).json({ error: "缺少 API Key，请在请求头带上 Authorization: Bearer <key>" });
  } else if (isAuthThrottled(ip)) {
    res.status(429).json({ error: "无效请求过多，请 30 秒后重试" });
  } else {
    ctx = verifyApiKey(secret);
    if (ctx) {
      clearAuthFailures(ip);
    } else {
      recordAuthFailure(ip);
      res.status(401).json({ error: "API Key 无效、已停用或已过期" });
    }
  }

  if (ctx) {
    req.apiAuth = ctx;
    res.setHeader("X-Request-Id", randomUUID());
  }
  if (!res.writableEnded) next();
});

function requireScope(req: import("express").Request, res: import("express").Response, scope: ApiKeyScope) {
  const ctx = req.apiAuth;
  if (!ctx) {
    res.status(401).json({ error: "未授权" });
    return null;
  }
  if (!hasScope(ctx, scope)) {
    req.auditMessage = `缺少权限范围 ${scope}`;
    res.status(403).json({ error: `该 API Key 不具备 ${scope} 权限` });
    return null;
  }
  return ctx;
}

/** 该 Key 可见的账号；账号登录失效时列表可能为空。 */
function visibleAccounts(ctx: AuthContext, accountId = "") {
  const rows = accountId ? [{ accountId, session: getAccount(ctx.hubId, accountId) }] : accountsOf(ctx.hubId);
  return rows.filter((row): row is { accountId: string; session: VendorSession } => Boolean(row.session));
}

function present(device: DeviceSummary) {
  return {
    did: device.did,
    accountId: device.accountId || "",
    vendorId: device.vendorId,
    name: device.name,
    model: device.model,
    online: device.online,
    room: device.room,
    icon: device.icon,
    live: device.live || [],
  };
}

/** 从会话缓存取设备；缓存没有时先拉一次设备列表。 */
async function resolveDevice(session: VendorSession, did: string): Promise<DeviceSummary | null> {
  const cached = session.devices.get(did);
  if (cached) return cached;
  const provider = getVendor(session.vendorId);
  const rows = await provider.listDevices(session);
  return rows.find((row) => row.did === did) || session.devices.get(did) || null;
}

openRouter.get("/info", (req, res) => {
  const ctx = req.apiAuth!;
  res.json({
    keyId: ctx.keyId,
    keyName: ctx.keyName,
    scopes: ctx.scopes,
    accounts: visibleAccounts(ctx).map((row) => ({
      accountId: row.accountId,
      vendorId: row.session.vendorId,
      region: row.session.region,
    })),
  });
});

openRouter.get("/accounts", (req, res) => {
  const ctx = requireScope(req, res, "devices:read");
  if (!ctx) return;
  res.json({
    accounts: visibleAccounts(ctx).map((row) => ({
      accountId: row.accountId,
      vendorId: row.session.vendorId,
      region: row.session.region,
      deviceCount: row.session.devices.size,
    })),
  });
});

openRouter.get("/devices", async (req, res) => {
  const ctx = requireScope(req, res, "devices:read");
  if (!ctx) return;
  const accounts = visibleAccounts(ctx, String(req.query.accountId || ""));
  if (!accounts.length) {
    req.auditMessage = "账号不存在或登录已退出";
    return res.status(404).json({ error: "没有可分发的登录账号" });
  }
  const devices: ReturnType<typeof present>[] = [];
  const warnings: string[] = [];
  await Promise.all(
    accounts.map(async ({ accountId, session }) => {
      try {
        const rows = await getVendor(session.vendorId).listDevices(session);
        for (const row of rows) devices.push(present({ ...row, accountId }));
      } catch (error) {
        warnings.push(`${session.vendorId}: ${error instanceof Error ? error.message : "设备列表失败"}`);
      }
    }),
  );
  if (!devices.length && warnings.length) {
    req.auditMessage = warnings.join("；");
    return res.status(502).json({ error: warnings.join("；"), warnings });
  }
  res.json({ devices, warnings });
});

openRouter.get("/devices/:accountId/:did", async (req, res) => {
  const ctx = requireScope(req, res, "devices:read");
  if (!ctx) return;
  const session = getAccount(ctx.hubId, req.params.accountId);
  if (!session) {
    req.auditMessage = "账号不存在";
    return res.status(404).json({ error: "账号不存在" });
  }
  try {
    const detail = await getVendor(session.vendorId).getDeviceDetail(session, req.params.did);
    detail.device.accountId = req.params.accountId;
    res.json({ ...detail, device: present(detail.device) });
  } catch (error) {
    req.auditMessage = error instanceof Error ? error.message : "设备详情失败";
    res.status(error instanceof AppError ? error.status : 502).json(toPublicError(error));
  }
});

openRouter.get("/devices/:accountId/:did/props", async (req, res) => {
  const ctx = requireScope(req, res, "devices:read");
  if (!ctx) return;
  const session = getAccount(ctx.hubId, req.params.accountId);
  if (!session) return res.status(404).json({ error: "账号不存在" });
  try {
    const detail = await getVendor(session.vendorId).getDeviceDetail(session, req.params.did);
    const properties = detail.services.flatMap((service) =>
      service.properties.map((prop) => ({
        siid: prop.siid,
        piid: prop.piid,
        id: prop.id || "",
        name: prop.name,
        writable: prop.writable,
        unit: prop.unit || "",
        value: prop.value ?? null,
      })),
    );
    res.json({ did: req.params.did, properties });
  } catch (error) {
    req.auditMessage = error instanceof Error ? error.message : "属性读取失败";
    res.status(error instanceof AppError ? error.status : 502).json(toPublicError(error));
  }
});

openRouter.post("/devices/:accountId/:did/props", async (req, res) => {
  const ctx = requireScope(req, res, "devices:control");
  if (!ctx) return;
  const session = getAccount(ctx.hubId, req.params.accountId);
  if (!session) return res.status(404).json({ error: "账号不存在" });
  const { siid, piid, value, id } = req.body || {};
  if (siid == null || piid == null || value === undefined) {
    req.auditMessage = "参数不完整";
    return res.status(400).json({ error: "需要 siid、piid、value" });
  }
  try {
    await getVendor(session.vendorId).setProperty(
      session,
      req.params.did,
      Number(siid),
      Number(piid),
      value,
      id ? String(id) : undefined,
    );
    res.json({ ok: true });
  } catch (error) {
    req.auditMessage = error instanceof Error ? error.message : "属性写入失败";
    res.status(error instanceof AppError ? error.status : 502).json(toPublicError(error));
  }
});

openRouter.post("/devices/:accountId/:did/actions", async (req, res) => {
  const ctx = requireScope(req, res, "devices:control");
  if (!ctx) return;
  const session = getAccount(ctx.hubId, req.params.accountId);
  if (!session) return res.status(404).json({ error: "账号不存在" });
  const { siid, aiid } = req.body || {};
  if (siid == null || aiid == null) {
    req.auditMessage = "参数不完整";
    return res.status(400).json({ error: "需要 siid、aiid" });
  }
  try {
    await getVendor(session.vendorId).runAction(session, req.params.did, Number(siid), Number(aiid));
    res.json({ ok: true });
  } catch (error) {
    req.auditMessage = error instanceof Error ? error.message : "动作执行失败";
    res.status(error instanceof AppError ? error.status : 502).json(toPublicError(error));
  }
});

/** 读取实时读数；did 为空时读取该 Key 可见的全部设备。 */
async function readLive(req: import("express").Request, res: import("express").Response, did: string) {
  const ctx = requireScope(req, res, "devices:live");
  if (!ctx) return;
  const accounts = visibleAccounts(ctx, String(req.query.accountId || ""));
  const live: Record<string, unknown> = {};
  await Promise.all(
    accounts.map(async ({ accountId, session }) => {
      try {
        const provider = getVendor(session.vendorId);
        let devices: DeviceSummary[];
        if (did) {
          const target = await resolveDevice(session, did);
          if (!target) return;
          devices = [{ ...target, accountId }];
        } else {
          if (!session.devices.size) await provider.listDevices(session);
          devices = [...session.devices.values()].map((row) => ({ ...row, accountId }));
        }
        if (!devices.length) return;
        const part = await provider.refreshLive(session, devices);
        for (const [key, items] of Object.entries(part)) live[`${accountId}:${key}`] = items;
      } catch {
        /* 单账号失败不影响其它账号 */
      }
    }),
  );
  res.json({ live });
}

openRouter.get("/live", (req, res) => readLive(req, res, ""));
openRouter.get("/live/:did", (req, res) => readLive(req, res, req.params.did));
