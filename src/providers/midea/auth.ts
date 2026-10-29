import crypto from "node:crypto";
import { AppError } from "../../core/errors.js";
import type { BinaryImage, PendingAuth, VendorSession } from "../types.js";
import { mas, stamp } from "./api.js";
import { APP_ID, APP_KEY, encryptIamPassword, encryptPassword, sessionKeyFromLogin } from "./crypto.js";
import { createAuthState, type MideaAuthState } from "./state.js";

function toSession(state: MideaAuthState): VendorSession {
  return {
    vendorId: "midea",
    userId: state.userId,
    region: state.region,
    devices: new Map(),
    state,
  };
}

export function createMideaPending(region: string): PendingAuth {
  return {
    vendorId: "midea",
    region,
    state: createAuthState(region, ""),
    createdAt: Date.now(),
  };
}

function sniffImage(body: Buffer) {
  if (body.length > 8 && body[0] === 0x89 && body[1] === 0x50) return "image/png";
  if (body.length > 3 && body[0] === 0xff && body[1] === 0xd8) return "image/jpeg";
  if (body.length > 6 && body.subarray(0, 3).toString() === "GIF") return "image/gif";
  if (body.length > 12 && body.subarray(0, 4).toString() === "RIFF" && body.subarray(8, 12).toString() === "WEBP") return "image/webp";
  return "";
}

async function readCaptcha(value: string) {
  const text = value.trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) {
    const response = await fetch(text);
    if (!response.ok) return null;
    const body = Buffer.from(await response.arrayBuffer());
    const type = sniffImage(body);
    return type ? { body, type } : null;
  }
  const matched = text.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/);
  const body = Buffer.from(matched ? matched[2] : text, "base64");
  const type = matched?.[1] || sniffImage(body);
  return type ? { body, type } : null;
}

export async function sendSms(pending: PendingAuth, captcha = ""): Promise<{ needCaptcha: boolean }> {
  const account = (pending.username || "").trim();
  if (!/^1\d{10}$/.test(account)) throw new AppError("请填写手机号", "AUTH", 400);
  const previous = pending.state as { randomToken?: string };
  const state = createAuthState(pending.region, account);
  state.randomToken = previous?.randomToken || "";
  pending.state = state;
  const now = stamp();
  const data: Record<string, unknown> = { deviceId: state.deviceId };
  if (state.randomToken) data.randomToken = state.randomToken;
  if (captcha.trim()) data.imgCode = captcha.trim();
  const result = await mas(state, "/mj/user/getSmsCode", {
    iotData: {
      mobile: account,
      type: 9,
      iotAppId: APP_ID,
      deviceId: state.deviceId,
      reqId: crypto.randomBytes(16).toString("hex"),
      stamp: now,
    },
    data,
    timestamp: now,
    stamp: now,
  });
  const token = String(result.randomToken || "");
  if (token) state.randomToken = token;
  const image = await readCaptcha(String(result.imgCode || ""));
  if (image) {
    state.captchaBody = image.body;
    state.captchaType = image.type;
    return { needCaptcha: true };
  }
  state.captchaBody = null;
  state.captchaType = "";
  return { needCaptcha: false };
}

export async function getCaptchaImage(pending: PendingAuth): Promise<BinaryImage> {
  const state = pending.state as { captchaBody?: Buffer | null; captchaType?: string };
  if (!state.captchaBody) throw new AppError("没有图形验证码", "CAPTCHA", 404);
  return { body: state.captchaBody, type: state.captchaType || "image/png" };
}

function acceptLogin(pending: PendingAuth, state: MideaAuthState, logged: Record<string, unknown>, account: string) {
  const mdata = (logged.mdata || {}) as Record<string, unknown>;
  state.accessToken = String(mdata.accessToken || logged.accessToken || "");
  if (!state.accessToken) throw new AppError("未拿到 accessToken", "NO_TOKEN", 400);
  const userInfo = (logged.userInfo || {}) as Record<string, unknown>;
  state.userId = String(logged.uid || userInfo.uid || userInfo.mobile || account);
  if (typeof logged.key === "string" && logged.key) {
    try {
      state.sessionKey = sessionKeyFromLogin(logged.key);
    } catch {
      state.sessionKey = null;
    }
  }
  pending.password = "";
  return { kind: "ok" as const, session: toSession(state) };
}

export async function loginSms(pending: PendingAuth): Promise<{ kind: "ok"; session: VendorSession }> {
  const account = (pending.username || "").trim();
  const smsCode = (pending.password || "").trim();
  if (!/^1\d{10}$/.test(account) || !smsCode) throw new AppError("请填写手机号和短信验证码", "AUTH", 400);
  const previous = pending.state as { randomToken?: string };
  const state = createAuthState(pending.region, account);
  state.randomToken = previous?.randomToken || "";
  pending.state = state;
  const now = stamp();
  const logged = await mas(state, "/v6/mj/user/register", {
    iotData: {
      mobile: account,
      smsCode,
      iotAppId: APP_ID,
      loginType: 0,
      appVersion: "11.7.15.3",
      deviceId: state.deviceId,
      reqId: crypto.randomBytes(16).toString("hex"),
      stamp: now,
    },
    data: {
      appKey: APP_KEY,
      deviceId: state.deviceId,
      platform: 2,
    },
    timestamp: now,
    stamp: now,
  });
  return acceptLogin(pending, state, logged, account);
}

export async function loginPassword(pending: PendingAuth): Promise<{ kind: "ok"; session: VendorSession }> {
  const account = (pending.username || "").trim();
  const password = pending.password || "";
  if (!account || !password) throw new AppError("请填写账号和密码", "AUTH", 400);
  const state = createAuthState(pending.region, account);
  pending.state = state;
  const login = await mas(state, "/v1/user/login/id/get", {
    loginAccount: account,
    type: "1",
  });
  const loginId = String(login.loginId || "");
  if (!loginId) throw new AppError("未拿到登录凭证", "NO_LOGIN_ID", 400);
  const now = stamp();
  const logged = await mas(state, "/mj/user/login", {
    iotData: {
      clientType: 1,
      deviceId: state.deviceId,
      iampwd: encryptIamPassword(password),
      iotAppId: APP_ID,
      loginAccount: account,
      password: encryptPassword(loginId, password),
      reqId: crypto.randomBytes(16).toString("hex"),
      stamp: now,
    },
    data: {
      appKey: APP_KEY,
      deviceId: state.deviceId,
      platform: 2,
    },
    timestamp: now,
    stamp: now,
  });
  return acceptLogin(pending, state, logged, account);
}
