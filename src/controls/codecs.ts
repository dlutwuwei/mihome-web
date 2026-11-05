import type { ControlOption, FieldRule } from "./types.js";

export type CodecArgs = Record<string, unknown>;

/** 档案里的枚举键总是字符串，这里还原成面板值可以比较的类型 */
export function coerce(text: string): string | number | boolean {
  if (text === "true" || text === "false") return text === "true";
  const value = Number(text);
  return text !== "" && Number.isFinite(value) ? value : text;
}

/** options 支持数组和 {"1":"强"} 两种写法，统一成数组 */
export function normalizeOptions(options?: ControlOption[] | Record<string, string>): ControlOption[] {
  if (!options) return [];
  if (Array.isArray(options)) return options;
  return Object.entries(options).map(([value, name]) => ({ value: coerce(value), name }));
}

/** 转换器可以看到的现场信息：设备此刻的原始值和适配器存的写回线索 */
export interface CodecCtx {
  raw?: unknown;
  meta?: Record<string, unknown>;
}

/** 双向转换器：decode 把设备原始值变成面板值，encode 反向变成写回值 */
export interface Codec {
  decode(raw: unknown, args: CodecArgs, ctx?: CodecCtx): unknown;
  encode(value: unknown, args: CodecArgs, ctx?: CodecCtx): unknown;
}

function num(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value: number, digits?: unknown) {
  if (typeof digits !== "number") return value;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

const TRUTHY = new Set(["1", "on", "true", "yes", "open", "开", "开启"]);

function truthy(raw: unknown) {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw !== 0;
  const text = String(raw ?? "").trim().toLowerCase();
  return TRUTHY.has(text);
}

const bool: Codec = { decode: (raw) => truthy(raw), encode: (value) => truthy(value) };

/** 字符串形态的布尔对子：写回时必须还给设备原来的那种写法 */
const BOOL_PAIRS: Array<[string, string]> = [
  ["on", "off"],
  ["1", "0"],
  ["true", "false"],
  ["open", "close"],
  ["enable", "disable"],
  ["yes", "no"],
];

function castString(sample: string, on: boolean) {
  const lower = sample.toLowerCase();
  for (const [truthyText, falsyText] of BOOL_PAIRS) {
    if (lower === truthyText) return on ? sample : falsyText;
    if (lower === falsyText) return on ? truthyText : sample;
  }
  /* 猜不出反义写法时保持原样，总好过写回一个设备不认的 "true" */
  return sample;
}

/** 按设备当前原始值的形态还原写回值：同一字段在不同机型上可能是 "on" / "1" / 1 / true */
function castTo(sample: unknown, value: unknown) {
  if (typeof value === "boolean") {
    if (typeof sample === "boolean") return value;
    if (typeof sample === "string") return castString(sample, value);
    if (typeof sample === "number") return value ? 1 : 0;
  }
  if (typeof sample === "string") return String(value ?? "");
  if (typeof sample === "boolean") return truthy(value);
  if (typeof sample === "number") return num(value) ?? value;
  return value;
}

const shape: Codec = { decode: (raw) => raw, encode: (value, _args, ctx) => castTo(ctx?.raw, value) };
const shapebool: Codec = { decode: (raw) => truthy(raw), encode: (value, _args, ctx) => castTo(ctx?.raw, truthy(value)) };
const shapenum: Codec = {
  decode: (raw, args) => {
    const value = num(raw);
    return value == null ? null : round(value, args.digits);
  },
  encode: (value, _args, ctx) => castTo(ctx?.raw, num(value) ?? value),
};

const BOOLISH = /^(on|off|true|false|0|1)$/i;
/** 没配转换器时的兼容选择：布尔形态自动识别，其余原样传递 */
const auto: Codec = {
  decode: (raw) => {
    if (typeof raw === "boolean" || typeof raw === "number") return raw;
    const text = String(raw ?? "").trim();
    return BOOLISH.test(text) ? truthy(text) : raw;
  },
  encode: (value, _args, ctx) => castTo(ctx?.raw, value),
};

function booleanCodec(encodeValue: (on: boolean) => unknown): Codec {
  return { decode: (raw) => truthy(raw), encode: (value) => encodeValue(truthy(value)) };
}

const numberCodec: Codec = {
  decode: (raw, args) => {
    const value = num(raw);
    return value == null ? null : round(value, args.digits);
  },
  encode: (value, args) => {
    const parsed = num(value);
    if (parsed == null) return String(value ?? "");
    const rounded = round(parsed, args.digits);
    return args.text ? String(rounded) : rounded;
  },
};

const scale: Codec = {
  decode: (raw, args) => {
    const value = num(raw);
    const by = num(args.by) ?? 1;
    return value == null ? null : round(value / by, args.digits);
  },
  encode: (value, args) => {
    const parsed = num(value);
    const by = num(args.by) ?? 1;
    return parsed == null ? null : round(parsed * by, args.digits);
  },
};

const offset: Codec = {
  decode: (raw, args) => {
    const value = num(raw);
    return value == null ? null : value - (num(args.by) ?? 0);
  },
  encode: (value, args) => {
    const parsed = num(value);
    return parsed == null ? null : parsed + (num(args.by) ?? 0);
  },
};

function tableOf(args: CodecArgs) {
  const source = args.table;
  const rows: Record<string, unknown> = source && typeof source === "object" ? { ...source } : {};
  if (Array.isArray(args.pairs)) {
    for (const pair of args.pairs as unknown[][]) rows[String(pair[0])] = pair[1];
  }
  return rows;
}

const map: Codec = {
  decode: (raw, args) => {
    const rows = tableOf(args);
    const key = String(raw);
    return key in rows ? rows[key] : raw;
  },
  encode: (value, args) => {
    const rows = tableOf(args);
    for (const [key, mapped] of Object.entries(rows)) {
      if (String(mapped) === String(value)) return deviceKey(key, args);
    }
    return value;
  },
};

/** 档案里的键总是字符串，写回时按设备原始形态还原成数字（args.strings 可强制保留字符串） */
function deviceKey(key: string, args: CodecArgs) {
  if (args.strings) return key;
  const value = num(key);
  return value == null ? key : value;
}

const duration: Codec = {
  decode: (raw) => {
    const minutes = num(raw);
    if (minutes == null) return "";
    if (minutes <= 0) return "—";
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return hours ? (rest ? `${hours}小时${rest}分` : `${hours}小时`) : `${rest}分钟`;
  },
  encode: (value) => num(value) ?? value,
};

export const identity: Codec = { decode: (raw) => raw, encode: (value) => value };

const codecs = new Map<string, Codec>([
  ["identity", identity],
  ["bool", bool],
  ["shape", shape],
  ["shapebool", shapebool],
  ["shapenum", shapenum],
  ["auto", auto],
  ["onoff", booleanCodec((on) => (on ? "on" : "off"))],
  ["zeroone", booleanCodec((on) => (on ? "1" : "0"))],
  ["numbool", booleanCodec((on) => (on ? 1 : 0))],
  ["number", numberCodec],
  ["scale", scale],
  ["offset", offset],
  ["map", map],
  ["duration", duration],
]);

export function registerCodec(id: string, codec: Codec) {
  codecs.set(id, codec);
}

/** 给配置界面用的说明：档案里能写哪些 codec 名字 */
const CODEC_DOCS: Record<string, string> = {
  identity: "原值直通",
  bool: "任意形态转成布尔",
  shape: "写回时还原设备当前形态",
  shapebool: "读作布尔，写回按原形态",
  shapenum: "读作数字，写回按原形态",
  auto: "布尔形态自动识别，其余直通",
  onoff: "布尔 <-> on / off（字符串）",
  zeroone: "布尔 <-> 0 / 1（字符串）",
  numbool: "布尔 <-> 1 / 0（数字）",
  number: "数字，args.digits 控制小数位",
  scale: "线性缩放，args.by 为倍率",
  offset: "偏移，args.by 为减量",
  map: "枚举映射，args.table 或 args.pairs",
  duration: "分钟数 <-> “1小时20分”",
};

export function listCodecs() {
  return [...codecs.keys()].map((id) => ({ id, hint: CODEC_DOCS[id] || "" }));
}

export function getCodec(id?: string): Codec {
  return (id && codecs.get(id)) || identity;
}

/**
 * 配了 map 转换器的字段，枚举表本身就可以当选项列表；
 * 档案里没写 options 时用它，避免“能读能写但没得选”。
 */
export function codecOptions(rule: FieldRule): ControlOption[] {
  if (rule.options) return normalizeOptions(rule.options);
  if (rule.codec !== "map") return [];
  const rows = tableOf(rule.codecArgs || {});
  return Object.entries(rows).map(([key, name]) => ({
    value: num(key) ?? key,
    name: String(name ?? key),
  }));
}
