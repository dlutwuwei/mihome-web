import { AppError } from "../../core/errors.js";
import { decryptRc4, encParams, nonce, signedNonce } from "./crypto.js";
import { asXiaomi, regionHost, type XiaomiAuthState } from "./state.js";

export async function apiCall(state: XiaomiAuthState, path: string, data: unknown) {
  const url = `${regionHost(state.region)}${path}`;
  const rawNonce = nonce();
  const signNonce = signedNonce(state.ssecurity, rawNonce);
  const payload = JSON.stringify(data).replace(/"(home_id|home_owner)":"(\d+)"/g, '"$1":$2');
  const fields = encParams(url, "POST", signNonce, rawNonce, { data: payload }, state.ssecurity);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Accept-Encoding": "identity",
      "User-Agent": state.ua,
      "Content-Type": "application/x-www-form-urlencoded",
      "x-xiaomi-protocal-flag-cli": "PROTOCAL-HTTP2",
      "MIOT-ENCRYPT-ALGORITHM": "ENCRYPT-RC4",
      Cookie: [
        `userId=${state.userId}`,
        `yetAnotherServiceToken=${state.serviceToken}`,
        `serviceToken=${state.serviceToken}`,
        "locale=zh_CN",
        "timezone=GMT+08:00",
        "is_daylight=0",
        "dst_offset=0",
        "channel=MI_APP_STORE",
      ].join("; "),
    },
    body: new URLSearchParams(fields).toString(),
  });
  const text = await response.text();
  if (!response.ok) throw new AppError(`云端 HTTP ${response.status}`, response.status, 502);
  let decoded: string;
  try {
    decoded = decryptRc4(signedNonce(state.ssecurity, fields._nonce), text);
  } catch {
    throw new AppError("云端响应无法解密", "DECRYPT", 502);
  }
  const body = JSON.parse(decoded.replace(/:\s*(-?\d{16,})/g, ':"$1"')) as {
    code: number;
    message?: string;
    desc?: string;
    result?: unknown;
  };
  if (body.code !== 0) {
    throw new AppError(body.message || body.desc || `云端错误 ${body.code}`, body.code, 502);
  }
  return body.result;
}

export function sessionState(sessionState: unknown) {
  return asXiaomi(sessionState);
}
