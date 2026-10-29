import { AppError } from "../../core/errors.js";
import type { LoginOutcome, PendingAuth, VendorSession } from "../types.js";
import { md5Upper } from "./crypto.js";
import { follow, http, parseJsonBody } from "./http.js";
import { asXiaomi, createAuthState, type XiaomiAuthState } from "./state.js";

function toSession(state: XiaomiAuthState): VendorSession {
  return {
    vendorId: "xiaomi",
    userId: state.userId,
    region: state.region,
    devices: new Map(),
    state,
  };
}

async function finishLocation(state: XiaomiAuthState, location: string) {
  await follow(state.jar, location, state.ua);
  state.serviceToken = state.jar.get("serviceToken");
  if (!state.serviceToken) throw new AppError("未拿到 serviceToken", "NO_TOKEN", 400);
  return toSession(state);
}

export function createXiaomiPending(region: string): PendingAuth {
  return {
    vendorId: "xiaomi",
    region,
    state: createAuthState(region),
    createdAt: Date.now(),
  };
}

export async function loginPassword(pending: PendingAuth, captcha = ""): Promise<LoginOutcome> {
  const state = asXiaomi(pending.state);
  const username = pending.username || "";
  const password = pending.password || "";
  state.jar.set("userId", username);

  const step1 = await http(state.jar, "https://account.xiaomi.com/pass/serviceLogin?sid=xiaomiio&_json=true", {
    headers: { "User-Agent": state.ua },
  });
  const signBody = parseJsonBody(step1.text) || {};
  if (!signBody._sign && !signBody.ssecurity) {
    throw new AppError(String(signBody.desc || "账号校验失败"), String(signBody.code || "STEP1"), 400);
  }
  if (signBody.ssecurity && signBody.location) {
    state.ssecurity = String(signBody.ssecurity);
    state.userId = String(signBody.userId || "");
    state.cUserId = String(signBody.cUserId || "");
    return { kind: "ok", session: await finishLocation(state, String(signBody.location)) };
  }

  const fields: Record<string, string> = {
    sid: "xiaomiio",
    hash: md5Upper(password),
    callback: "https://sts.api.io.mi.com/sts",
    qs: "%3Fsid%3Dxiaomiio%26_json%3Dtrue",
    user: username,
    _sign: String(signBody._sign || ""),
    _json: "true",
  };
  if (captcha) fields.captCode = captcha;

  const step2 = await http(state.jar, "https://account.xiaomi.com/pass/serviceLoginAuth2", {
    method: "POST",
    query: fields,
    headers: { "User-Agent": state.ua, "Content-Type": "application/x-www-form-urlencoded" },
  });
  const body = parseJsonBody(step2.text) || {};
  if (body.captchaUrl) {
    const captchaUrl = String(body.captchaUrl).startsWith("http")
      ? String(body.captchaUrl)
      : `https://account.xiaomi.com${body.captchaUrl}`;
    state.captchaUrl = captchaUrl;
    pending.captchaUrl = captchaUrl;
    return { kind: "captcha", pending, captchaUrl };
  }
  if (body.notificationUrl && !(body.ssecurity && String(body.ssecurity).length > 4)) {
    pending.notificationUrl = String(body.notificationUrl);
    state.notificationUrl = String(body.notificationUrl);
    return { kind: "email", pending };
  }
  if (!(body.ssecurity && String(body.ssecurity).length > 4 && body.location)) {
    throw new AppError(String(body.desc || body.description || "登录失败"), body.code as string | number || "AUTH", 400);
  }
  state.ssecurity = String(body.ssecurity);
  state.userId = String(body.userId || "");
  state.cUserId = String(body.cUserId || "");
  state.password = "";
  pending.password = "";
  return { kind: "ok", session: await finishLocation(state, String(body.location)) };
}

export async function beginEmail2fa(pending: PendingAuth) {
  const state = asXiaomi(pending.state);
  const notificationUrl = pending.notificationUrl || state.notificationUrl || "";
  await http(state.jar, notificationUrl, { headers: { "User-Agent": state.ua } });
  const context = new URL(notificationUrl).searchParams.get("context") || "";
  await http(state.jar, "https://account.xiaomi.com/identity/list", {
    query: { sid: "xiaomiio", context, _locale: "zh_CN" },
    headers: { "User-Agent": state.ua },
  });
  const sent = await http(state.jar, "https://account.xiaomi.com/identity/auth/sendEmailTicket", {
    method: "POST",
    query: {
      _dc: String(Date.now()),
      sid: "xiaomiio",
      context,
      mask: "0",
      _locale: "zh_CN",
    },
    body: new URLSearchParams({
      retry: "0",
      icode: "",
      _json: "true",
      ick: state.jar.get("ick"),
    }).toString(),
    headers: { "User-Agent": state.ua, "Content-Type": "application/x-www-form-urlencoded" },
  });
  const body = parseJsonBody(sent.text) || {};
  if (body.code && body.code !== 0) {
    throw new AppError(String(body.desc || body.description || "验证码发送失败"), body.code as string | number, 400);
  }
  state.emailContext = context;
  return pending;
}

export async function verifyEmail2fa(pending: PendingAuth, code: string) {
  const state = asXiaomi(pending.state);
  const response = await http(state.jar, "https://account.xiaomi.com/identity/auth/verifyEmail", {
    method: "POST",
    query: {
      _flag: "8",
      _json: "true",
      sid: "xiaomiio",
      context: state.emailContext || "",
      mask: "0",
      _locale: "zh_CN",
    },
    body: new URLSearchParams({
      _flag: "8",
      ticket: code,
      trust: "false",
      _json: "true",
      ick: state.jar.get("ick"),
    }).toString(),
    headers: { "User-Agent": state.ua, "Content-Type": "application/x-www-form-urlencoded" },
  });
  const body = parseJsonBody(response.text) || {};
  let location = String(body.location || response.headers.get("location") || "");
  if (location.includes("identity/result/check")) {
    const hop = await http(state.jar, location, { headers: { "User-Agent": state.ua } });
    location = hop.headers.get("location") || "";
  }
  if (!location) throw new AppError(String(body.desc || "邮箱验证未完成"), body.code as string | number || "VERIFY", 400);
  const end = await http(state.jar, location, { headers: { "User-Agent": state.ua } });
  const pragma = end.headers.get("extension-pragma");
  if (pragma) {
    try {
      const extra = JSON.parse(pragma) as { ssecurity?: string };
      if (extra.ssecurity) state.ssecurity = extra.ssecurity;
    } catch {
      /* optional */
    }
  }
  const sts = end.headers.get("location") || "";
  if (!state.ssecurity) throw new AppError("验证后缺少安全凭证", "NO_SSECURITY", 400);
  if (!sts) throw new AppError("验证后缺少跳转", "NO_STS", 400);
  state.userId = state.userId || state.jar.get("userId");
  state.password = "";
  pending.password = "";
  return finishLocation(state, sts);
}

export async function beginQr(pending: PendingAuth) {
  const state = asXiaomi(pending.state);
  const response = await http(state.jar, "https://account.xiaomi.com/longPolling/loginUrl", {
    query: {
      _qrsize: "480",
      qs: "%3Fsid%3Dxiaomiio%26_json%3Dtrue",
      callback: "https://sts.api.io.mi.com/sts",
      _hasLogo: "false",
      sid: "xiaomiio",
      serviceParam: "",
      _locale: "zh_CN",
      _dc: String(Date.now()),
    },
    headers: { "User-Agent": state.ua },
  });
  const body = parseJsonBody(response.text);
  if (!body?.lp || !body?.qr) throw new AppError("二维码获取失败", "QR", 502);
  state.lp = String(body.lp);
  state.qr = String(body.qr);
  state.loginUrl = String(body.loginUrl || "");
  return pending;
}

export async function pollQr(pending: PendingAuth) {
  const state = asXiaomi(pending.state);
  if (!state.lp) throw new AppError("二维码已过期", "QR", 400);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const headers: Record<string, string> = { "User-Agent": state.ua };
    const cookie = state.jar.header();
    if (cookie) headers.cookie = cookie;
    const response = await fetch(state.lp, { headers, signal: controller.signal, redirect: "manual" });
    state.jar.absorb(response);
    const text = await response.text();
    if (response.status !== 200) return null;
    const body = parseJsonBody(text);
    if (!body?.ssecurity || !body?.location) return null;
    state.ssecurity = String(body.ssecurity);
    state.userId = String(body.userId || "");
    state.cUserId = String(body.cUserId || "");
    return finishLocation(state, String(body.location));
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return null;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function getCaptchaImage(pending: PendingAuth) {
  const state = asXiaomi(pending.state);
  const url = pending.captchaUrl || state.captchaUrl || "";
  if (!url) throw new AppError("验证码不存在", "CAPTCHA", 404);
  const response = await fetch(url, { headers: { "User-Agent": state.ua, Cookie: state.jar.header() } });
  state.jar.absorb(response);
  return {
    body: Buffer.from(await response.arrayBuffer()),
    type: response.headers.get("content-type") || "image/jpeg",
  };
}

export async function getQrImage(pending: PendingAuth) {
  const state = asXiaomi(pending.state);
  if (!state.qr) throw new AppError("二维码不存在", "QR", 404);
  const response = await fetch(state.qr, {
    headers: { "User-Agent": state.ua, Cookie: state.jar.header() },
  });
  state.jar.absorb(response);
  return {
    body: Buffer.from(await response.arrayBuffer()),
    type: response.headers.get("content-type") || "image/png",
  };
}
