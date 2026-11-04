import { createHash, createHmac, randomUUID } from "node:crypto";
import https from "node:https";
import { AppError } from "../../core/errors.js";

const BASE = "https://api-cloudprint.pantum.com";
const SECRET = "AdOK0dsdF9sSDkj344";
const MAX_BYTES = 20 * 1024 * 1024;

const FILE_TYPE: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
};

export interface CloudDevice {
  did: string;
  sn: string;
  pid: number;
  name: string;
  model: string;
  online: boolean;
}

export interface CloudSession {
  token: string;
  userId: string;
  mobile: string;
}

interface Envelope<T> {
  code?: number;
  success?: boolean;
  message?: string;
  data?: T;
}

export async function sendLoginCode(mobile: string) {
  await call<unknown>({
    method: "POST",
    path: "/api/app/auth/verify/getMobileVerifyCode",
    body: { mobile, type: "LOGIN" },
  });
}

export async function loginByPhone(mobile: string, verifyCode: string): Promise<CloudSession> {
  const data = await call<{
    userInfo?: { id?: string };
    userToken?: { access_token?: string };
  }>({
    method: "POST",
    path: "/api/app/auth/login/loginByPhone",
    body: { mobile, verifyCode },
  });
  const token = data?.userToken?.access_token || "";
  if (!token) throw new AppError("登录未返回令牌", "AUTH", 502);
  return { token, userId: data?.userInfo?.id || mobile, mobile };
}

export async function listBindDevices(token: string): Promise<CloudDevice[]> {
  const data = await call<{ bindDeviceList?: Array<Record<string, unknown>> }>({
    method: "POST",
    path: "/api/app/device/v1/bindDeviceList",
    token,
  });
  return (data?.bindDeviceList || []).map(toDevice).filter((item) => item.sn && item.pid);
}

export interface PrintOptions {
  collate: string;
  duplex: string;
  feeder: string;
  mode: string;
  numOfCopies: number;
  paperSize: string;
  paperType: string;
}

const COLLATE = new Set(["collate", "non-collate"]);
const DUPLEX = new Set(["simplex", "duplex_long_edge", "duplex_short_edge", "manual_duplex_long_edge", "manual_duplex_short_edge"]);
const FEEDER = new Set(["auto", "auto_tray", "standard_tray", "manual_tray", "mpf_tray", "tray_1"]);
const MODE = new Set(["bw", "color"]);
const PAPER = new Set(["A3", "A4", "A5", "A6", "Letter", "Legal", "16K", "JIS_B5", "4x6"]);
const PAPER_TYPE = new Set(["plain", "plain_1", "tissue", "tough_1", "cardstock", "envelope", "labels", "recycled_paper", "photo_plain"]);

export function printOptionsFrom(fields: Record<string, string | undefined>): PrintOptions {
  return {
    collate: oneOf(fields.collate, COLLATE, "non-collate", "逐份"),
    duplex: oneOf(fields.duplex, DUPLEX, "simplex", "单双面"),
    feeder: oneOf(fields.feeder, FEEDER, "auto", "进纸"),
    mode: oneOf(fields.mode, MODE, "bw", "色彩"),
    numOfCopies: copiesOf(fields.copies),
    paperSize: oneOf(fields.paperSize, PAPER, "A4", "纸张"),
    paperType: oneOf(fields.paperType, PAPER_TYPE, "plain_1", "纸张类型"),
  };
}

function oneOf(value: string | undefined, allowed: Set<string>, fallback: string, name: string) {
  const picked = (value || "").trim() || fallback;
  if (!allowed.has(picked)) throw new AppError(`${name}不正确`, "PRINT", 400);
  return picked;
}

function copiesOf(value: string | undefined) {
  const copies = Number((value || "").trim() || 1);
  if (!Number.isInteger(copies) || copies < 1 || copies > 99) throw new AppError("份数需为 1 到 99", "PRINT", 400);
  return copies;
}

export async function printCloudFile(token: string, device: CloudDevice, body: Buffer, mime: string, _filename: string, options: PrintOptions) {
  if (body.length > MAX_BYTES) throw new AppError("文件超过 20MB", "PRINT", 400);
  const fileType = fileTypeOf(mime, body);
  const sts = await call<Record<string, string>>({
    method: "GET",
    path: "/api/app/appendix/sts/getAssume",
    token,
  });
  const url = await putOss(sts, body, fileType);
  const pages = fileType === "pdf" ? pdfPages(body) : 1;
  await call({
    method: "POST",
    path: "/api/app/print/v1/createTask",
    token,
    body: {
      sn: device.sn,
      pid: device.pid,
      fileType,
      pageCount: pages * options.numOfCopies,
      printSetting: {
        collate: options.collate,
        duplex: options.duplex,
        feeder: options.feeder,
        mode: options.mode,
        numOfCopies: options.numOfCopies,
        paperSize: options.paperSize,
        paperType: options.paperType,
      },
      fileUrl: [url],
      resourceLevel: 0,
    },
  });
}

async function call<T>(input: { method: "GET" | "POST"; path: string; token?: string; body?: unknown }): Promise<T> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const raw = input.body == null ? "" : JSON.stringify(input.body);
  const headers: Record<string, string> = {
    UserAgent: "Pantum/android/2.24.2//mihome/",
    countryCode: "CN",
    "Accept-Language": "zh-Hans",
    sign: signOf(raw, timestamp),
    timestamp,
  };
  if (input.token) headers.Authorization = `Bearer ${input.token}`;
  if (raw) headers["Content-Type"] = "application/json;charset=utf-8";
  const response = await fetch(`${BASE}${input.path}`, {
    method: input.method,
    headers,
    body: raw || undefined,
    signal: AbortSignal.timeout(20000),
  });
  const text = await response.text();
  let json: Envelope<T>;
  try {
    json = JSON.parse(text) as Envelope<T>;
  } catch {
    console.error("[print] cloud", input.method, input.path, response.status, text.slice(0, 2000));
    if (raw) console.error("[print] cloud body", raw.slice(0, 2000));
    throw new AppError(text.slice(0, 180) || `云打印请求失败 (${response.status})`, "CLOUD", 502);
  }
  if (json.success === false || (json.code != null && json.code !== 200 && json.code !== 0)) {
    console.error("[print] cloud", input.method, input.path, response.status, text.slice(0, 2000));
    if (raw) console.error("[print] cloud body", raw.slice(0, 2000));
    throw new AppError(json.message || "云打印请求失败", "CLOUD", response.status >= 400 ? response.status : 502);
  }
  return json.data as T;
}

function signOf(body: string, timestamp: string) {
  const raw = `${body ? `_body=${body}&` : ""}timestamp=${timestamp}&secret=${SECRET}`;
  return createHash("md5").update(raw, "utf8").digest("hex").toUpperCase();
}

function toDevice(row: Record<string, unknown>): CloudDevice {
  const sn = String(row.sn || "");
  const pid = Number(row.pid || 0);
  const name = String(row.nickName || row.productName || "奔图打印机");
  return {
    did: String(row.id || `${pid}-${sn}`),
    sn,
    pid,
    name,
    model: String(row.productName || row.productNameNew || "奔图"),
    online: Boolean(row.online),
  };
}

function fileTypeOf(mime: string, body: Buffer) {
  const known = FILE_TYPE[mime.toLowerCase()];
  if (known) return known;
  if (body.subarray(0, 4).toString("utf8") === "%PDF") return "pdf";
  if (body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return "jpg";
  if (body[0] === 0x89 && body[1] === 0x50 && body[2] === 0x4e && body[3] === 0x47) return "png";
  throw new AppError("仅支持 PDF、JPEG、PNG", "PRINT", 400);
}

function pdfPages(body: Buffer) {
  const text = body.toString("latin1");
  const matches = text.match(/\/Type\s*\/Page(?!s)/g);
  return Math.max(1, matches?.length || 1);
}

async function putOss(sts: Record<string, string>, body: Buffer, fileType: string) {
  const bucket = sts.bucketName;
  const host = String(sts.wanAddr || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const prefix = String(sts.uploadUrl || "").replace(/^\/+|\/+$/g, "");
  if (!bucket || !host || !sts.accessKeyId || !sts.accessKeySecret || !sts.securityToken) {
    throw new AppError("上传凭证不完整", "PRINT", 502);
  }
  const ext = fileType === "jpg" ? "jpg" : fileType;
  const key = `${prefix}/${stamp()}/${randomUUID()}/file.${ext}`.replace(/^\/+/, "");
  const contentType = fileType === "pdf" ? "application/pdf" : fileType === "png" ? "image/png" : "image/jpeg";
  const date = new Date().toUTCString();
  const tagging = "expiration_1=1";
  const stringToSign = `PUT\n\n${contentType}\n${date}\nx-oss-security-token:${sts.securityToken}\nx-oss-tagging:${tagging}\n/${bucket}/${key}`;
  const signature = createHmac("sha1", sts.accessKeySecret).update(stringToSign).digest("base64");
  const path = key.split("/").map(encodeURIComponent).join("/");
  const uploaded = await putHttps(`https://${bucket}.${host}/${path}`, {
    Date: date,
    "Content-Type": contentType,
    "x-oss-security-token": sts.securityToken,
    "x-oss-tagging": tagging,
    Authorization: `OSS ${sts.accessKeyId}:${signature}`,
  }, body);
  if (uploaded.status < 200 || uploaded.status >= 300) {
    const detail = uploaded.text.replaceAll(sts.securityToken, "***");
    console.error("[print] oss", uploaded.status, `${bucket}/${key}`, detail.slice(0, 2000));
    console.error("[print] oss stringToSign", stringToSign.replaceAll(sts.securityToken, "***"));
    throw new AppError(ossError(uploaded.text, uploaded.status), "PRINT", 502);
  }
  return `https://${bucket}.${host}/${key}`;
}

function ossError(xml: string, status: number) {
  const code = xml.match(/<Code>([^<]*)<\/Code>/)?.[1];
  const message = xml.match(/<Message>([^<]*)<\/Message>/)?.[1];
  const expected = xml.match(/<StringToSign>([\s\S]*?)<\/StringToSign>/)?.[1];
  const head = [code, message].filter(Boolean).join(": ") || `文件上传失败 (${status})`;
  return expected ? `${head}；服务端待签串：${expected.replace(/\n/g, "\\n")}` : head;
}

function putHttps(url: string, headers: Record<string, string>, body: Buffer) {
  return new Promise<{ status: number; text: string }>((resolve, reject) => {
    const req = https.request(url, { method: "PUT", headers, timeout: 60000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode || 0, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("上传超时")));
    req.end(body);
  });
}

function stamp() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}
