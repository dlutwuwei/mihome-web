import crypto from "node:crypto";

export function nonce() {
  const buf = Buffer.alloc(12);
  crypto.randomBytes(8).copy(buf, 0);
  buf.writeUInt32BE(Math.floor(Date.now() / 60000), 8);
  return buf.toString("base64");
}

export function signedNonce(ssecurity: string, value: string) {
  return crypto
    .createHash("sha256")
    .update(Buffer.from(ssecurity, "base64"))
    .update(Buffer.from(value, "base64"))
    .digest("base64");
}

function rc4Stream(key: Buffer) {
  const s = Array.from({ length: 256 }, (_, index) => index);
  let j = 0;
  for (let i = 0; i < 256; i += 1) {
    j = (j + s[i] + key[i % key.length]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
  }
  let i = 0;
  j = 0;
  return (size: number) => {
    const out = Buffer.alloc(size);
    for (let n = 0; n < size; n += 1) {
      i = (i + 1) & 255;
      j = (j + s[i]) & 255;
      [s[i], s[j]] = [s[j], s[i]];
      out[n] = s[(s[i] + s[j]) & 255];
    }
    return out;
  };
}

function rc4(keyB64: string, payload: Buffer) {
  const stream = rc4Stream(Buffer.from(keyB64, "base64"));
  stream(1024);
  const mask = stream(payload.length);
  const out = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i += 1) out[i] = payload[i] ^ mask[i];
  return out;
}

export function encryptRc4(keyB64: string, text: string) {
  return rc4(keyB64, Buffer.from(text, "utf8")).toString("base64");
}

export function decryptRc4(keyB64: string, text: string) {
  return rc4(keyB64, Buffer.from(text.trim(), "base64")).toString("utf8");
}

function encSignature(url: string, method: string, signNonce: string, params: Record<string, string>) {
  const path = url.split("com")[1].replace("/app/", "/");
  const parts = [String(method).toUpperCase(), path];
  for (const [key, value] of Object.entries(params)) parts.push(`${key}=${value}`);
  parts.push(signNonce);
  return crypto.createHash("sha1").update(parts.join("&"), "utf8").digest("base64");
}

export function encParams(
  url: string,
  method: string,
  signNonce: string,
  rawNonce: string,
  params: Record<string, string>,
  ssecurity: string,
) {
  const fields: Record<string, string> = { ...params };
  fields.rc4_hash__ = encSignature(url, method, signNonce, fields);
  for (const key of Object.keys(fields)) fields[key] = encryptRc4(signNonce, fields[key]);
  fields.signature = encSignature(url, method, signNonce, fields);
  fields.ssecurity = ssecurity;
  fields._nonce = rawNonce;
  return fields;
}

export function md5Upper(text: string) {
  return crypto.createHash("md5").update(text).digest("hex").toUpperCase();
}
