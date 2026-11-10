#!/usr/bin/env node
import process from "node:process";

const DEFAULT_BASE_URL = "http://127.0.0.1:8787";
const DEFAULT_TIMEOUT_SECONDS = 30;

const USAGE = `mihome — 米家设备分发与控制的命令行工具（输出 JSON，供大模型调用）

用法:
  mihome info                              当前 Key 的信息与权限范围
  mihome accounts                          可见的账号
  mihome devices [--account <id>] [--filter <关键词>]
  mihome device <设备> [--account <id>]     设备详情（面板属性与动作）
  mihome props <设备> [--account <id>] [--writable]
  mihome live [设备] [--account <id>]       实时读数
  mihome set <设备> <字段> <值> [--account <id>] [--type <类型>] [--force]
  mihome set <设备> --siid <n> --piid <n> --value <值> [...]
  mihome action <设备> <动作> [--account <id>]
  mihome api <METHOD> <path> [--body <JSON>]  直接调用开放 API（兜底）
  mihome help [命令]

设备参数:
  传 did 或设备名（精确匹配优先，其次唯一包含匹配）。名称不唯一时会返回候选列表。

写值与动作:
  <值> 默认按字段当前类型推断：true/false/开/关 → 布尔，数字 → 数值；
  若字段有可选值，也可直接写选项名称（例如 "制冷"）。
  --type string|number|boolean|json 可强制类型。
  只读字段默认拒绝，--force 可跳过面板的可写判断。
  设备离线时默认拒绝控制，--allow-offline 可跳过。

环境变量:
  MIHOME_API_KEY    必需，开放 API Key（Authorization: Bearer <key>）
  MIHOME_BASE_URL   可选，默认 ${DEFAULT_BASE_URL}；可带或不带 /api/open
  MIHOME_TIMEOUT    可选，请求超时秒数，默认 ${DEFAULT_TIMEOUT_SECONDS}

其它参数:
  --base-url <url>  覆盖 MIHOME_BASE_URL
  --api-key <key>   覆盖 MIHOME_API_KEY（更推荐用环境变量，避免出现在进程列表）
  --timeout <秒>    覆盖超时
  --pretty          缩进输出；默认单行紧凑 JSON

退出码:
  0 成功；1 接口或网络错误；2 用法或配置错误。错误以 JSON 写到 stderr。

示例:
  export MIHOME_API_KEY=mihome_xxx
  mihome devices --filter 洗衣机
  mihome props 洗衣机
  mihome set 洗衣机 program 标准洗
  mihome set 洗衣机 power true
  mihome action 洗衣机 启动
`;

const COMMON_FLAGS = ["base-url", "api-key", "timeout", "pretty", "help"];
const COMMAND_FLAGS = {
  info: [],
  accounts: [],
  devices: ["account", "filter"],
  device: ["account"],
  props: ["account", "writable"],
  live: ["account"],
  set: ["account", "type", "siid", "piid", "value", "force", "allow-offline"],
  action: ["account", "allow-offline"],
  api: ["body"],
  help: [],
};

const BOOLEAN_FLAGS = new Set(["help", "pretty", "writable", "force", "allow-offline"]);

class CliError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.exitCode = options.exitCode ?? 1;
    this.details = options.details;
  }
}

class UsageError extends CliError {
  constructor(message, details) {
    super(message, { exitCode: 2, details });
  }
}

function parseArgs(argv) {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg === "-h") {
      flags.help = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq >= 0 ? arg.slice(2, eq) : arg.slice(2);
    let value;
    if (eq >= 0) {
      value = arg.slice(eq + 1);
    } else if (BOOLEAN_FLAGS.has(name)) {
      value = true;
    } else {
      if (i + 1 >= argv.length) throw new UsageError(`参数 --${name} 需要一个值`);
      value = argv[(i += 1)];
    }
    if (BOOLEAN_FLAGS.has(name)) {
      flags[name] = value === true ? true : !/^(false|0|no|off)$/i.test(String(value));
    } else {
      flags[name] = value;
    }
  }
  return { flags, positionals };
}

function assertKnownFlags(command, flags) {
  const allowed = new Set([...COMMON_FLAGS, ...(COMMAND_FLAGS[command] || [])]);
  const unknown = Object.keys(flags).filter((name) => !allowed.has(name));
  if (unknown.length) throw new UsageError(`未知参数：${unknown.map((name) => `--${name}`).join(", ")}`);
}

function baseUrl(flags) {
  let raw = String(flags["base-url"] || process.env.MIHOME_BASE_URL || DEFAULT_BASE_URL).trim();
  if (!/^https?:\/\//i.test(raw)) raw = `http://${raw}`;
  raw = raw.replace(/\/+$/, "");
  return raw.endsWith("/api/open") ? raw : `${raw}/api/open`;
}

function timeoutMs(flags) {
  const raw = flags.timeout ?? process.env.MIHOME_TIMEOUT ?? DEFAULT_TIMEOUT_SECONDS;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new UsageError(`无效的超时时间：${raw}`);
  return seconds * 1000;
}

function apiKey(flags) {
  const key = String(flags["api-key"] || process.env.MIHOME_API_KEY || "").trim();
  if (!key) throw new UsageError("缺少 API Key，请设置 MIHOME_API_KEY 或传 --api-key", {
    hint: "Key 在站内「设备信息分发」里创建",
  });
  return key;
}

async function api(method, path, { flags, body, query } = {}) {
  const token = apiKey(flags);
  const signal = AbortSignal.timeout(timeoutMs(flags));
  const url = new URL(baseUrl(flags) + path);
  for (const [name, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(name, String(value));
  }

  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "请求失败";
    throw new CliError(`无法连接 ${url.origin}：${reason}`, { details: { baseUrl: baseUrl(flags) } });
  }

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    const message =
      data && typeof data === "object" && typeof data.error === "string"
        ? data.error
        : `HTTP ${response.status}`;
    throw new CliError(message, {
      details: {
        status: response.status,
        requestId: response.headers.get("x-request-id") || undefined,
        body: data ?? undefined,
      },
    });
  }
  return data;
}

function segment(value) {
  return encodeURIComponent(String(value));
}

function brief(device) {
  return {
    did: device.did,
    accountId: device.accountId,
    name: device.name,
    online: device.online,
  };
}

function sameText(left, right) {
  return String(left ?? "").trim().toLowerCase() === String(right ?? "").trim().toLowerCase();
}

async function resolveDevice(target, flags) {
  const accountId = flags.account ? String(flags.account) : "";
  const data = await api("GET", "/devices", { flags, query: { accountId } });
  const devices = Array.isArray(data?.devices) ? data.devices : [];
  const byIdentity = devices.filter((row) => row.did === target || sameText(row.name, target));
  const matches = byIdentity.length
    ? byIdentity
    : devices.filter((row) => String(row.name).toLowerCase().includes(String(target).trim().toLowerCase()));

  if (matches.length === 1) return matches[0];
  if (!matches.length) {
    throw new CliError(`找不到设备：${target}`, {
      details: { devices: devices.map(brief) },
    });
  }
  throw new CliError(`设备名不唯一：${target}`, {
    details: { candidates: matches.map(brief) },
  });
}

async function getDetail(device, flags) {
  return api("GET", `/devices/${segment(device.accountId)}/${segment(device.did)}`, { flags });
}

function actionsOf(detail) {
  return (detail.services || []).flatMap((service) =>
    (service.actions || []).map((action) => ({
      id: action.id || `${action.siid}.${action.aiid}`,
      name: action.name,
      siid: action.siid,
      aiid: action.aiid,
      service: service.name,
    })),
  );
}

function propertiesOf(detail) {
  return (detail.services || []).flatMap((service) =>
    (service.properties || []).map((prop) => ({
      id: prop.id || `${prop.siid}.${prop.piid}`,
      name: prop.name,
      siid: prop.siid,
      piid: prop.piid,
      value: prop.value ?? null,
      writable: Boolean(prop.writable),
      kind: prop.kind || "",
      unit: prop.unit || "",
      ...(Array.isArray(prop.range) && prop.range.length ? { range: prop.range } : {}),
      ...(Array.isArray(prop.list) && prop.list.length
        ? { options: prop.list.map((item) => ({ value: item.value, name: item.name })) }
        : {}),
      service: service.name,
    })),
  );
}

function ensureOnline(device, flags) {
  if (device.online === false && !flags["allow-offline"]) {
    throw new CliError(`设备离线，无法控制：${device.name}`, {
      details: { did: device.did, accountId: device.accountId, hint: "确认设备通电联网，或传 --allow-offline 强制尝试" },
    });
  }
}

function findProp(properties, field) {
  const compact = /^(\d+)\.(\d+)$/.exec(field);
  if (compact) {
    const siid = Number(compact[1]);
    const piid = Number(compact[2]);
    return properties.find((prop) => prop.siid === siid && prop.piid === piid) || null;
  }
  const exact = properties.filter(
    (prop) => sameText(prop.id, field) || sameText(prop.name, field),
  );
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    throw new CliError(`字段名不唯一：${field}`, {
      details: { candidates: exact.map(({ id, name, siid, piid }) => ({ id, name, siid, piid })) },
    });
  }
  const fuzzy = properties.filter((prop) => String(prop.name).includes(field));
  if (fuzzy.length === 1) return fuzzy[0];
  if (fuzzy.length > 1) {
    throw new CliError(`字段名不唯一：${field}`, {
      details: { candidates: fuzzy.map(({ id, name, siid, piid }) => ({ id, name, siid, piid })) },
    });
  }
  return null;
}

function parseBoolean(raw) {
  const text = String(raw).trim().toLowerCase();
  if (["true", "1", "on", "开", "是", "yes"].includes(text)) return true;
  if (["false", "0", "off", "关", "否", "no"].includes(text)) return false;
  throw new UsageError(`无法把 ${raw} 解析为布尔值，请用 true/false 或 --type string`);
}

function coerceValue(raw, prop, type) {
  const text = String(raw);
  if (type) {
    switch (type.toLowerCase()) {
      case "string":
        return text;
      case "number": {
        const number = Number(text);
        if (!Number.isFinite(number)) throw new UsageError(`无法把 ${raw} 解析为数字`);
        return number;
      }
      case "boolean":
        return parseBoolean(text);
      case "json":
        try {
          return JSON.parse(text);
        } catch {
          throw new UsageError(`无法把 ${raw} 解析为 JSON`);
        }
      default:
        throw new UsageError(`未知类型：${type}（可选 string/number/boolean/json）`);
    }
  }

  const options = prop && Array.isArray(prop.options) ? prop.options : [];
  if (options.length) {
    const byName = options.filter((item) => sameText(item.name, text));
    if (byName.length === 1) return byName[0].value;
    const byValue = options.filter((item) => sameText(item.value, text));
    if (byValue.length === 1) return byValue[0].value;
  }

  const hint = prop ? prop.value : undefined;
  if (typeof hint === "boolean" || /^(true|false|on|off|开|关)$/i.test(text.trim())) return parseBoolean(text);
  if (typeof hint === "number") {
    const number = Number(text);
    return Number.isFinite(number) ? number : text;
  }
  if (/^-?\d+(\.\d+)?$/.test(text.trim())) return Number(text);
  return text;
}

function emit(data, flags) {
  process.stdout.write(`${flags.pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data)}\n`);
}

function printHelp(command) {
  if (command && command !== "help") {
    const line = USAGE.split("\n").find((item) => item.trim().startsWith(`mihome ${command}`));
    if (line) {
      process.stdout.write(`${line.trim()}\n\n${USAGE}`);
      return;
    }
  }
  process.stdout.write(USAGE);
}

async function main(argv) {
  const { flags, positionals } = parseArgs(argv);
  const command = positionals[0] || (flags.help ? "help" : "");
  if (!command) throw new UsageError("缺少命令");
  assertKnownFlags(command, flags);
  if (flags.help && command !== "help") {
    printHelp(command);
    return;
  }

  const target = positionals[1];
  const needTarget = () => {
    if (!target) throw new UsageError(`命令 ${command} 需要设备参数（did 或名称）`);
    return target;
  };

  switch (command) {
    case "help":
      printHelp(positionals[1]);
      return;

    case "info":
      emit(await api("GET", "/info", { flags }), flags);
      return;

    case "accounts":
      emit(await api("GET", "/accounts", { flags }), flags);
      return;

    case "devices": {
      const data = await api("GET", "/devices", {
        flags,
        query: { accountId: flags.account },
      });
      const filter = flags.filter ? String(flags.filter).toLowerCase() : "";
      const devices = (data?.devices || []).filter((row) =>
        filter
          ? [row.name, row.model, row.room, row.did, row.vendorId]
              .some((value) => String(value || "").toLowerCase().includes(filter))
          : true,
      );
      emit({ count: devices.length, devices, ...(data?.warnings?.length ? { warnings: data.warnings } : {}) }, flags);
      return;
    }

    case "device": {
      const device = await resolveDevice(needTarget(), flags);
      emit(await getDetail(device, flags), flags);
      return;
    }

    case "props": {
      const device = await resolveDevice(needTarget(), flags);
      const detail = await getDetail(device, flags);
      let properties = propertiesOf(detail);
      if (flags.writable) properties = properties.filter((prop) => prop.writable);
      emit(
        {
          did: device.did,
          accountId: device.accountId,
          name: device.name,
          model: device.model,
          online: device.online,
          properties,
          actions: actionsOf(detail),
        },
        flags,
      );
      return;
    }

    case "live": {
      if (!target) {
        emit(await api("GET", "/live", { flags, query: { accountId: flags.account } }), flags);
        return;
      }
      const device = await resolveDevice(target, flags);
      emit(
        await api("GET", `/live/${segment(device.did)}`, {
          flags,
          query: { accountId: device.accountId },
        }),
        flags,
      );
      return;
    }

    case "set": {
      const device = await resolveDevice(needTarget(), flags);
      ensureOnline(device, flags);
      const detail = await getDetail(device, flags);
      const properties = propertiesOf(detail);

      const siidFlag = flags.siid;
      const piidFlag = flags.piid;
      const hasSiidPair = siidFlag !== undefined || piidFlag !== undefined;
      if (hasSiidPair && (siidFlag === undefined || piidFlag === undefined)) {
        throw new UsageError("--siid 与 --piid 需要同时提供");
      }

      const field = hasSiidPair ? undefined : positionals[2];
      if (!hasSiidPair && !field) throw new UsageError("用法：mihome set <设备> <字段> <值>");

      const rawValue = flags.value !== undefined ? flags.value : positionals[hasSiidPair ? 2 : 3];
      if (rawValue === undefined) throw new UsageError("缺少要写入的值");

      let prop;
      if (hasSiidPair) {
        const siid = Number(siidFlag);
        const piid = Number(piidFlag);
        if (!Number.isInteger(siid) || !Number.isInteger(piid)) {
          throw new UsageError("--siid 与 --piid 必须是整数");
        }
        prop = properties.find((row) => row.siid === siid && row.piid === piid) || null;
      } else {
        prop = findProp(properties, field);
        if (!prop) {
          throw new CliError(`字段不存在：${field}`, {
            details: {
              properties: properties
                .filter((row) => row.writable)
                .map(({ id, name, siid, piid, value }) => ({ id, name, siid, piid, value })),
            },
          });
        }
      }

      if (prop && !prop.writable && !flags.force) {
        throw new CliError(`字段只读：${prop.name}；如确需写入请加 --force`, {
          details: { id: prop.id, siid: prop.siid, piid: prop.piid },
        });
      }

      const value = coerceValue(rawValue, prop, flags.type);
      const body = {
        siid: prop ? prop.siid : Number(siidFlag),
        piid: prop ? prop.piid : Number(piidFlag),
        value,
        ...(prop?.id && !/^\d+\.\d+$/.test(prop.id) ? { id: prop.id } : {}),
      };
      await api("POST", `/devices/${segment(device.accountId)}/${segment(device.did)}/props`, { flags, body });
      emit(
        {
          ok: true,
          did: device.did,
          accountId: device.accountId,
          property: prop
            ? { id: prop.id, name: prop.name, siid: prop.siid, piid: prop.piid }
            : { siid: body.siid, piid: body.piid },
          value,
        },
        flags,
      );
      return;
    }

    case "action": {
      const device = await resolveDevice(needTarget(), flags);
      ensureOnline(device, flags);
      const actionName = positionals[2];
      if (!actionName) throw new UsageError("用法：mihome action <设备> <动作>");
      const detail = await getDetail(device, flags);
      const actions = actionsOf(detail);
      const exact = actions.filter((row) => sameText(row.id, actionName) || sameText(row.name, actionName));
      const matches = exact.length
        ? exact
        : actions.filter((row) => String(row.name).includes(actionName));
      if (!matches.length) {
        throw new CliError(`动作不存在：${actionName}`, { details: { actions } });
      }
      if (matches.length > 1) {
        throw new CliError(`动作名不唯一：${actionName}`, { details: { candidates: matches } });
      }
      const action = matches[0];
      await api("POST", `/devices/${segment(device.accountId)}/${segment(device.did)}/actions`, {
        flags,
        body: { siid: action.siid, aiid: action.aiid },
      });
      emit({ ok: true, did: device.did, accountId: device.accountId, action }, flags);
      return;
    }

    case "api": {
      const method = String(positionals[1] || "").toUpperCase();
      const path = positionals[2];
      if (!method || !path) throw new UsageError("用法：mihome api <METHOD> <path> [--body <JSON>]");
      if (!path.startsWith("/")) throw new UsageError("path 必须以 / 开头，例如 /devices");
      let body;
      if (flags.body !== undefined) {
        try {
          body = JSON.parse(flags.body);
        } catch {
          throw new UsageError("--body 需要是合法 JSON");
        }
      }
      emit(await api(method, path, { flags, body }), flags);
      return;
    }

    default:
      throw new UsageError(`未知命令：${command}`);
  }
}

main(process.argv.slice(2)).catch((error) => {
  const payload =
    error instanceof CliError
      ? { error: error.message, ...(error.details || {}) }
      : { error: error instanceof Error ? error.message : String(error) };
  process.stderr.write(`${JSON.stringify(payload)}\n`);
  if (error instanceof UsageError) process.stderr.write(`${JSON.stringify({ hint: "运行 mihome help 查看用法" })}\n`);
  process.exitCode = error instanceof CliError ? error.exitCode : 1;
});
