import crypto from "node:crypto";
import { AppError } from "../../core/errors.js";
import { sign } from "./crypto.js";
import { asMidea, hostOf, type MideaAuthState } from "./state.js";

export function stamp() {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

function parseBody(text: string) {
  const raw = text.replace(/:\s*(-?\d{15,})(?=\s*[,}\]])/g, ':"$1"');
  return JSON.parse(raw) as { code?: number | string; msg?: string; message?: string; data?: unknown };
}

export async function mas(state: MideaAuthState, endpoint: string, data: Record<string, unknown>) {
  const payload: Record<string, unknown> = { ...data };
  if (!payload.reqId) payload.reqId = crypto.randomBytes(16).toString("hex");
  if (!payload.stamp) payload.stamp = stamp();
  const body = JSON.stringify(payload);
  const random = String(Math.floor(Date.now() / 1000));
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    secretVersion: "1",
    sign: sign(body, random),
    random,
  };
  if (state.accessToken) headers.accesstoken = state.accessToken;
  const response = await fetch(`${hostOf(state.region)}/mas/v5/app/proxy?alias=${endpoint}`, {
    method: "POST",
    headers,
    body,
  });
  const text = await response.text();
  if (!response.ok) throw new AppError(`云端 HTTP ${response.status}`, response.status, 502);
  let parsed: ReturnType<typeof parseBody>;
  try {
    parsed = parseBody(text);
  } catch {
    throw new AppError("云端响应无法解析", "PARSE", 502);
  }
  if (Number(parsed.code) !== 0) {
    throw new AppError(parsed.msg || parsed.message || `云端错误 ${parsed.code}`, parsed.code ?? "CLOUD", 400);
  }
  return (parsed.data ?? {}) as Record<string, unknown>;
}

export function sessionState(state: unknown) {
  return asMidea(state);
}
