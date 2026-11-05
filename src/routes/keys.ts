import { Router } from "express";
import {
  API_KEY_SCOPES,
  clearAudit,
  createApiKey,
  listApiKeys,
  listAudit,
  revokeApiKey,
  setApiKeyEnabled,
  type ApiKeyScope,
} from "../core/apikey.js";
import { readHubId } from "../core/session.js";

export const keysRouter = Router();

/** 管理接口沿用站内登录态（hub Cookie）。 */
function requireHub(req: import("express").Request, res: import("express").Response) {
  const hubId = readHubId(req.headers.cookie);
  if (!hubId) {
    res.status(401).json({ error: "未登录" });
    return "";
  }
  return hubId;
}

keysRouter.get("/scopes", (_req, res) => {
  res.json({ scopes: API_KEY_SCOPES });
});

keysRouter.get("/", (req, res) => {
  const hubId = requireHub(req, res);
  if (!hubId) return;
  res.json({ keys: listApiKeys(hubId) });
});

keysRouter.post("/", (req, res) => {
  const hubId = requireHub(req, res);
  if (!hubId) return;
  const body = req.body || {};
  const name = String(body.name || "").trim();
  if (!name) return res.status(400).json({ error: "请填写 Key 名称" });
  const requested: string[] = Array.isArray(body.scopes) ? body.scopes.map((item: unknown) => String(item)) : [];
  const scopes = API_KEY_SCOPES.filter((scope) => requested.includes(scope)) as ApiKeyScope[];
  if (!scopes.length) return res.status(400).json({ error: "至少选择一个权限范围" });
  const days = Number(body.expiresInDays || 0);
  if (days < 0 || days > 3650) return res.status(400).json({ error: "有效期天数需在 0-3650 之间" });
  const { key, secret } = createApiKey(hubId, name, scopes, Number.isFinite(days) ? days : 0);
  res.status(201).json({ key, secret });
});

keysRouter.post("/:id/enabled", (req, res) => {
  const hubId = requireHub(req, res);
  if (!hubId) return;
  const enabled = Boolean(req.body?.enabled);
  const key = setApiKeyEnabled(hubId, req.params.id, enabled);
  if (!key) return res.status(404).json({ error: "Key 不存在" });
  res.json({ key });
});

keysRouter.delete("/:id", (req, res) => {
  const hubId = requireHub(req, res);
  if (!hubId) return;
  if (!revokeApiKey(hubId, req.params.id)) return res.status(404).json({ error: "Key 不存在" });
  res.json({ ok: true });
});

keysRouter.get("/audit/requests", (req, res) => {
  const hubId = requireHub(req, res);
  if (!hubId) return;
  const keyId = String(req.query.keyId || "");
  const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 1000);
  res.json({ requests: listAudit(hubId, keyId, limit) });
});

keysRouter.post("/audit/clear", (req, res) => {
  const hubId = requireHub(req, res);
  if (!hubId) return;
  clearAudit(hubId);
  res.json({ ok: true });
});
