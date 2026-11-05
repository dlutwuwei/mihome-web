#!/usr/bin/env node
/**
 * 用 Cloudflare Tunnel 把本地开发服务暴露成公网 HTTPS 地址。
 *
 * 默认使用 TryCloudflare 快速隧道，无需登录、无需公网 IP：
 *   npm run tunnel
 *
 * 使用 Zero Trust 固定隧道（令牌来自控制台）：
 *   TUNNEL_TOKEN=xxx npm run tunnel
 *
 * 或使用本机已登录的命名隧道：
 *   TUNNEL_NAME=mihome npm run tunnel
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PORT = String(process.env.PORT || "8787");
const TARGET =
  process.env.TUNNEL_TARGET_URL ||
  `http://${process.env.TUNNEL_TARGET_HOST || "127.0.0.1"}:${PORT}`;
const TOKEN = String(process.env.TUNNEL_TOKEN || "").trim();
const NAME = String(process.env.TUNNEL_NAME || "").trim();
const HOSTNAME = String(process.env.TUNNEL_HOSTNAME || "").trim();
const URL_FILE = path.resolve(process.cwd(), "data", "tunnel-url.txt");
const ANSI = /\x1b\[[0-9;]*m/g;
const TRY_URL = /https:\/\/[a-z0-9][a-z0-9-]*\.trycloudflare\.com/i;

function fail(message) {
  console.error(`\n[tunnel] ${message}\n`);
  process.exit(1);
}

const probe = spawnSync("cloudflared", ["--version"], { encoding: "utf8" });
if (probe.error && probe.error.code === "ENOENT") {
  fail(
    [
      "未找到 cloudflared，请先安装：",
      "  macOS:  brew install cloudflared",
      "  Linux:  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/",
      "安装后重新执行 npm run tunnel。",
    ].join("\n")
  );
}
if (probe.status !== 0) {
  fail(`cloudflared 不可用：${(probe.stderr || probe.stdout || "").trim() || "未知错误"}`);
}

let mode = "quick";
let args;
if (TOKEN) {
  mode = "token";
  args = ["--no-autoupdate", "tunnel", "run"];
} else if (NAME) {
  mode = "name";
  args = ["--no-autoupdate", "tunnel", "run", NAME];
} else {
  args = ["--no-autoupdate", "tunnel", "--url", TARGET];
}

const modeText = {
  quick: "TryCloudflare 快速隧道（地址每次启动都会变化）",
  token: "Zero Trust 托管隧道（TUNNEL_TOKEN）",
  name: NAME ? `本机命名隧道 ${NAME}` : "本机命名隧道",
}[mode];

console.log(`[tunnel] 本地目标: ${TARGET}`);
console.log(`[tunnel] 模式: ${modeText}`);

try {
  await fetch(TARGET, { signal: AbortSignal.timeout(2000) });
} catch {
  console.warn("[tunnel] 提示: 本地服务暂时无法访问，请确认已另开终端执行 npm run dev。");
}
if (!TOKEN && !NAME) {
  console.log("[tunnel] 正在向 Cloudflare 申请公网地址…\n");
}

const child = spawn("cloudflared", args, {
  stdio: ["ignore", "pipe", "pipe"],
  env: process.env,
});

let publicUrl = "";
let finished = false;

function writeUrl(url) {
  try {
    fs.mkdirSync(path.dirname(URL_FILE), { recursive: true });
    fs.writeFileSync(URL_FILE, `${url}\n`, "utf8");
  } catch {
    /* 写不进去不影响隧道 */
  }
}

function reportUrl(url) {
  if (publicUrl) return;
  publicUrl = url;
  writeUrl(url);
  console.log("\n==================================================");
  console.log(" Cloudflare Tunnel 已就绪");
  console.log(` 公网地址: ${url}`);
  console.log(` 本地服务: ${TARGET}`);
  console.log(` 小程序「接入」页填这个地址即可`);
  console.log("==================================================\n");
}

function handleLine(raw) {
  const line = raw.replace(ANSI, "").trim();
  if (!line) return;

  const match = line.match(TRY_URL);
  if (match && mode === "quick") {
    reportUrl(match[0]);
    return;
  }

  if (/\b(ERR|WRN|error|failed|unable)\b/i.test(line)) {
    console.error(`[cloudflared] ${line}`);
  }
}

function collect(stream) {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) handleLine(line);
  });
}

collect(child.stdout);
collect(child.stderr);

if (mode === "token" || mode === "name") {
  console.log("\n==================================================");
  console.log(" Cloudflare Tunnel 已启动（Zero Trust）");
  console.log(` 公网地址: ${HOSTNAME || "（见 Zero Trust 控制台绑定的域名）"}`);
  console.log(` 本地服务: ${TARGET}`);
  console.log("==================================================\n");
}

const timer = setTimeout(() => {
  if (mode === "quick" && !publicUrl) {
    console.error(
      "[tunnel] 30 秒内没有拿到公网地址，请检查网络、代理或 Cloudflare 状态；" +
        "若是公司网络，可能需要放行 cloudflared 的出站连接。"
    );
  }
}, 30000);

child.on("error", (error) => {
  clearTimeout(timer);
  fail(`启动 cloudflared 失败：${error.message}`);
});

child.on("exit", (code, signal) => {
  clearTimeout(timer);
  finished = true;
  if (publicUrl && mode === "quick") {
    try {
      fs.unlinkSync(URL_FILE);
    } catch {
      /* ignore */
    }
  }
  if (!publicUrl && mode === "quick" && code !== 0) {
    console.error(
      `[tunnel] cloudflared 已退出（code=${code}${signal ? `, signal=${signal}` : ""}），没有生成公网地址。`
    );
  }
  process.exit(code == null ? 0 : code);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (!finished) child.kill(signal);
  });
}
