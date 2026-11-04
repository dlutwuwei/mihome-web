import Busboy from "busboy";
import { Router } from "express";
import { AppError, isAuthFailure, toPublicError } from "../core/errors.js";
import { getVendor } from "../core/registry.js";
import { accountsOf, getAccount, markAccountStatus, readHubId } from "../core/session.js";
import { printFile } from "../providers/pantum/index.js";
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
      markAccountStatus(hub.hubId, accountId, { state: "ok", checkedAt: Date.now() });
      for (const row of rows) devices.push({ ...row, accountId });
    } catch (error) {
      const message = error instanceof Error ? error.message : "设备列表失败";
      if (isAuthFailure(error)) {
        markAccountStatus(hub.hubId, accountId, { state: "expired", checkedAt: Date.now(), message });
      }
      warnings.push(`${session.vendorId}: ${message}`);
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

devicesRouter.post("/:accountId/:did/print", async (req, res) => {
  const hub = requireHub(req, res);
  if (!hub) return;
  const session = getAccount(hub.hubId, req.params.accountId);
  if (!session) return res.status(404).json({ error: "账号不存在" });
  if (session.vendorId !== "pantum") return res.status(400).json({ error: "该设备不支持上传打印" });
  let filename = "";
  try {
    const file = await readPrintFile(req);
    filename = file.filename;
    await printFile(session, req.params.did, file.body, file.mime, file.filename, file.fields);
    res.json({ ok: true });
  } catch (error) {
    console.error("[print]", req.params.did, filename, error instanceof Error ? error.stack || error.message : error);
    res.status(error instanceof AppError ? error.status : 502).json(toPublicError(error));
  }
});

function filenameOf(name: string | undefined) {
  if (!name) return "document";
  const decoded = Buffer.from(name, "latin1").toString("utf8");
  return decoded.includes("\uFFFD") ? name : decoded;
}

function readPrintFile(req: import("express").Request) {
  return new Promise<{ body: Buffer; mime: string; filename: string; fields: Record<string, string> }>((resolve, reject) => {
    const type = req.headers["content-type"] || "";
    if (!type.includes("multipart/form-data")) {
      reject(new AppError("请上传文件", "PRINT", 400));
      return;
    }
    const busboy = Busboy({ headers: req.headers, limits: { files: 1, fileSize: 20 * 1024 * 1024 } });
    const chunks: Buffer[] = [];
    const fields: Record<string, string> = {};
    let mime = "";
    let filename = "document";
    let sawFile = false;
    let tooBig = false;
    busboy.on("field", (name, value) => {
      fields[name] = value;
    });
    busboy.on("file", (name, file, info) => {
      if (name !== "file") {
        file.resume();
        return;
      }
      sawFile = true;
      mime = info.mimeType || "";
      filename = filenameOf(info.filename);
      file.on("data", (chunk: Buffer) => chunks.push(chunk));
      file.on("limit", () => {
        tooBig = true;
      });
    });
    busboy.on("error", (error: Error) => reject(error));
    busboy.on("finish", () => {
      if (tooBig) {
        reject(new AppError("文件超过 20MB", "PRINT", 400));
        return;
      }
      if (!sawFile) {
        reject(new AppError("请选择文件", "PRINT", 400));
        return;
      }
      resolve({ body: Buffer.concat(chunks), mime, filename, fields });
    });
    req.pipe(busboy);
  });
}

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
