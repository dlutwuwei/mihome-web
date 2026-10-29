import { Router } from "express";
import { AppError, toPublicError } from "../core/errors.js";
import { getVendor } from "../core/registry.js";
import {
  attachAccount,
  deleteHub,
  dropPending,
  keepPending,
  listAccounts,
  peekPending,
  putPending,
  readHubId,
  removeAccount,
  takePending,
} from "../core/session.js";
import type { VendorSession } from "../providers/types.js";

export const authRouter = Router();

function setHub(res: import("express").Response, hubId: string) {
  res.setHeader("Set-Cookie", `hub=${hubId}; HttpOnly; Path=/; Max-Age=15552000; SameSite=Lax`);
}

function clearHub(res: import("express").Response) {
  res.setHeader("Set-Cookie", "hub=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax");
}

function bind(req: import("express").Request, res: import("express").Response, session: VendorSession) {
  const linked = attachAccount(readHubId(req.headers.cookie), session);
  setHub(res, linked.hubId);
  return { ok: true as const, accountId: linked.accountId, accounts: linked.accounts };
}

authRouter.post("/login/password", async (req, res) => {
  const { username, password, region, captcha, pendingId, vendor = "xiaomi", method } = req.body || {};
  const useSms = method === "sms";
  let pending = pendingId ? takePending(String(pendingId)) : null;
  const restoreId = pendingId ? String(pendingId) : "";
  try {
    const provider = getVendor(String(pending?.vendorId || vendor));
    if (pendingId && !pending) return res.status(400).json({ error: "登录已过期，请重试" });
    if (!pending) {
      if (!username || !password) {
        const text = useSms ? "请填写手机号和短信验证码" : "请填写账号和密码";
        return res.status(400).json({ error: text });
      }
      pending = provider.createPending(String(region || "cn"));
    }
    if (username) pending.username = String(username);
    if (password) pending.password = String(password);
    if (useSms && !provider.loginSms) throw new AppError("该厂商不支持短信登录", "SMS", 400);
    const outcome = useSms && provider.loginSms
      ? await provider.loginSms(pending)
      : await provider.loginPassword(pending, captcha || "");
    if (outcome.kind === "captcha") {
      const id = keepPending(outcome.pending);
      return res.json({ needCaptcha: true, pendingId: id, vendor: provider.id });
    }
    if (outcome.kind === "email") {
      if (!provider.beginEmail2fa) throw new AppError("该厂商不支持邮箱验证", "EMAIL", 400);
      await provider.beginEmail2fa(outcome.pending);
      const id = keepPending(outcome.pending);
      return res.json({ needEmailCode: true, pendingId: id, vendor: provider.id });
    }
    res.json(bind(req, res, outcome.session));
  } catch (error) {
    if (pending && restoreId) putPending(restoreId, pending);
    res.status(error instanceof AppError ? error.status : 400).json(toPublicError(error));
  }
});

authRouter.post("/login/sms", async (req, res) => {
  const { username, region, captcha, pendingId, vendor = "midea" } = req.body || {};
  let pending = pendingId ? takePending(String(pendingId)) : null;
  const restoreId = pendingId ? String(pendingId) : "";
  try {
    const provider = getVendor(String(pending?.vendorId || vendor));
    if (pendingId && !pending) return res.status(400).json({ error: "登录已过期，请重试" });
    if (!provider.sendSms) throw new AppError("该厂商不支持短信登录", "SMS", 400);
    if (!pending) pending = provider.createPending(String(region || "cn"));
    pending.username = String(username || "");
    const outcome = await provider.sendSms(pending, String(captcha || ""));
    const id = keepPending(pending);
    if (outcome.needCaptcha) return res.json({ needCaptcha: true, pendingId: id, vendor: provider.id });
    res.json({ ok: true, pendingId: id, vendor: provider.id });
  } catch (error) {
    if (pending && restoreId) putPending(restoreId, pending);
    res.status(error instanceof AppError ? error.status : 400).json(toPublicError(error));
  }
});

authRouter.get("/login/captcha", async (req, res) => {
  const id = String(req.query.pendingId || "");
  const row = peekPending(id);
  if (!row) return res.status(404).end();
  try {
    const provider = getVendor(row.vendorId);
    if (!provider.getCaptchaImage) return res.status(404).end();
    const image = await provider.getCaptchaImage(row);
    putPending(id, row);
    res.setHeader("Content-Type", image.type.startsWith("image/") ? image.type : "image/jpeg");
    res.send(image.body);
  } catch (error) {
    res.status(502).json(toPublicError(error));
  }
});

authRouter.post("/login/email", async (req, res) => {
  const row = takePending(String(req.body?.pendingId || ""));
  if (!row) return res.status(400).json({ error: "验证已过期，请重新登录" });
  try {
    const provider = getVendor(row.vendorId);
    if (!provider.verifyEmail2fa) throw new AppError("该厂商不支持邮箱验证", "EMAIL", 400);
    const session = await provider.verifyEmail2fa(row, String(req.body?.code || "").trim());
    res.json(bind(req, res, session));
  } catch (error) {
    putPending(String(req.body?.pendingId || ""), row);
    res.status(error instanceof AppError ? error.status : 400).json(toPublicError(error));
  }
});

authRouter.post("/login/qr", async (req, res) => {
  try {
    const vendor = String(req.body?.vendor || "xiaomi");
    const provider = getVendor(vendor);
    if (!provider.beginQr) throw new AppError("该厂商不支持扫码登录", "QR", 400);
    const row = provider.createPending(String(req.body?.region || "cn"));
    await provider.beginQr(row);
    const pendingId = keepPending(row);
    res.json({
      pendingId,
      vendor: provider.id,
      image: `/api/login/qr/image?pendingId=${encodeURIComponent(pendingId)}`,
    });
  } catch (error) {
    res.status(502).json(toPublicError(error));
  }
});

authRouter.get("/login/qr/image", async (req, res) => {
  const id = String(req.query.pendingId || "");
  const row = peekPending(id);
  if (!row) return res.status(404).end();
  try {
    const provider = getVendor(row.vendorId);
    if (!provider.getQrImage) return res.status(404).end();
    const image = await provider.getQrImage(row);
    const mime = image.type.split(";")[0].trim().toLowerCase();
    res.setHeader("Content-Type", mime.startsWith("image/") ? mime : "image/png");
    res.send(image.body);
  } catch (error) {
    res.status(502).json(toPublicError(error));
  }
});

authRouter.post("/login/qr/poll", async (req, res) => {
  const id = String(req.body?.pendingId || "");
  const row = peekPending(id);
  if (!row) return res.status(400).json({ error: "二维码已过期" });
  row.createdAt = Date.now();
  try {
    const provider = getVendor(row.vendorId);
    if (!provider.pollQr) throw new AppError("该厂商不支持扫码登录", "QR", 400);
    const session = await provider.pollQr(row);
    if (!session) return res.json({ pending: true });
    dropPending(id);
    res.json(bind(req, res, session));
  } catch (error) {
    res.status(502).json(toPublicError(error));
  }
});

authRouter.post("/logout", (req, res) => {
  const hubId = readHubId(req.headers.cookie);
  const accountId = String(req.body?.accountId || "");
  if (accountId) {
    const accounts = removeAccount(hubId, accountId);
    if (!accounts.length) clearHub(res);
    return res.json({ ok: true, accounts });
  }
  deleteHub(hubId);
  clearHub(res);
  res.json({ ok: true, accounts: [] });
});

authRouter.get("/me", (req, res) => {
  res.json({ accounts: listAccounts(readHubId(req.headers.cookie)) });
});
