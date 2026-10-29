import { Router } from "express";
import { AppError, toPublicError } from "../core/errors.js";
import { getVendor } from "../core/registry.js";
import { accountsOf, getAccount, readHubId } from "../core/session.js";
import type { DeviceSummary, LiveItem } from "../providers/types.js";

export const devicesRouter = Router();

function requireHub(req: import("express").Request, res: import("express").Response) {
  const hubId = readHubId(req.headers.cookie);
  const accounts = accountsOf(hubId);
  if (!accounts.length) {
    res.status(401).json({ error: "未登录" });
    return null;
  }
  return { hubId, accounts };
}

devicesRouter.get("/", async (req, res) => {
  const hub = requireHub(req, res);
  if (!hub) return;
  const devices: DeviceSummary[] = [];
  const warnings: string[] = [];
  await Promise.all(hub.accounts.map(async ({ accountId, session }) => {
    try {
      const provider = getVendor(session.vendorId);
      const rows = await provider.listDevices(session);
      for (const row of rows) devices.push({ ...row, accountId });
    } catch (error) {
      warnings.push(`${session.vendorId}: ${error instanceof Error ? error.message : "设备列表失败"}`);
    }
  }));
  if (!devices.length && warnings.length) {
    return res.status(502).json({ error: warnings.join("；"), warnings });
  }
  res.json({ devices, warnings });
});

devicesRouter.get("/live", async (req, res) => {
  const hub = requireHub(req, res);
  if (!hub) return;
  const live: Record<string, LiveItem[]> = {};
  await Promise.all(hub.accounts.map(async ({ accountId, session }) => {
    const devices = [...session.devices.values()];
    if (!devices.length) return;
    try {
      const provider = getVendor(session.vendorId);
      const part = await provider.refreshLive(session, devices);
      for (const [did, items] of Object.entries(part)) live[`${accountId}:${did}`] = items;
    } catch {
      /* 单个厂商失败不影响其它账号 */
    }
  }));
  res.json({ live });
});

devicesRouter.get("/:accountId/:did", async (req, res) => {
  const hub = requireHub(req, res);
  if (!hub) return;
  const session = getAccount(hub.hubId, req.params.accountId);
  if (!session) return res.status(404).json({ error: "账号不存在" });
  try {
    const provider = getVendor(session.vendorId);
    const detail = await provider.getDeviceDetail(session, req.params.did);
    detail.device.accountId = req.params.accountId;
    res.json(detail);
  } catch (error) {
    res.status(error instanceof AppError ? error.status : 502).json(toPublicError(error));
  }
});

devicesRouter.post("/:accountId/:did/prop", async (req, res) => {
  const hub = requireHub(req, res);
  if (!hub) return;
  const session = getAccount(hub.hubId, req.params.accountId);
  if (!session) return res.status(404).json({ error: "账号不存在" });
  const { siid, piid, value } = req.body || {};
  try {
    const provider = getVendor(session.vendorId);
    await provider.setProperty(session, req.params.did, Number(siid), Number(piid), value);
    res.json({ ok: true });
  } catch (error) {
    res.status(error instanceof AppError ? error.status : 502).json(toPublicError(error));
  }
});

devicesRouter.post("/:accountId/:did/action", async (req, res) => {
  const hub = requireHub(req, res);
  if (!hub) return;
  const session = getAccount(hub.hubId, req.params.accountId);
  if (!session) return res.status(404).json({ error: "账号不存在" });
  const { siid, aiid } = req.body || {};
  try {
    const provider = getVendor(session.vendorId);
    await provider.runAction(session, req.params.did, Number(siid), Number(aiid));
    res.json({ ok: true });
  } catch (error) {
    res.status(error instanceof AppError ? error.status : 502).json(toPublicError(error));
  }
});
