import { createDecipheriv, createHash, createHmac } from "node:crypto";

export const APP_ID = "900";
export const APP_KEY = "46579c15";
const IOT_KEY = "prod_secret123@muc";
const HMAC_KEY = "PROD_VnoClJI9aikS8dyy";
const LOGIN_KEY = "ad0ee21d48a64bf49f4fb583ab76e799";
const FIXED_KEY = Buffer.from("96c7acdfdb8af79a", "ascii");

export function sign(body: string, random: string) {
  return createHmac("sha256", HMAC_KEY).update(IOT_KEY + body + random, "utf8").digest("hex");
}

export function deviceId(account: string) {
  return createHash("md5").update(`Hello, ${account}!`, "utf8").digest("hex").slice(0, 16);
}

export function encryptPassword(loginId: string, password: string) {
  const first = createHash("sha256").update(password, "utf8").digest("hex");
  return createHash("sha256").update(loginId + first + LOGIN_KEY, "utf8").digest("hex");
}

export function encryptIamPassword(password: string) {
  const first = createHash("md5").update(password, "utf8").digest("hex");
  return createHash("md5").update(first, "utf8").digest("hex");
}

export function decryptHex(hex: string, key: Buffer) {
  const decipher = createDecipheriv(`aes-${key.length * 8}-ecb`, key, null);
  return Buffer.concat([decipher.update(Buffer.from(hex, "hex")), decipher.final()]);
}

export function sessionKeyFromLogin(keyHex: string) {
  const text = decryptHex(keyHex, FIXED_KEY).toString("utf8");
  const key = Buffer.from(text, "ascii");
  return key.length === 16 || key.length === 24 || key.length === 32 ? key : null;
}

export function decryptSn(hex: string, key: Buffer | null) {
  if (!key || !/^[0-9a-fA-F]+$/.test(hex) || hex.length % 32 !== 0) return "";
  try {
    return decryptHex(hex, key).toString("utf8");
  } catch {
    return "";
  }
}
