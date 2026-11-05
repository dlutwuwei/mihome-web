import { AppError } from "../core/errors.js";
import type { DeviceAction, DeviceDetail, DeviceProperty, DeviceService, DeviceSummary } from "../providers/types.js";
import { codecOptions, getCodec } from "./codecs.js";
import type { CodecCtx } from "./codecs.js";
import { matchesPattern, resolveProfile, resolveRule } from "./profiles.js";
import type { ControlKind, ControlOption, FieldRule, ResolvedField, VendorAction, VendorField } from "./types.js";

function flatNames(options: ControlOption[]) {
  return options.every((item) => String(item.name).replace(/\s/g, "").length <= 6);
}

/** 只靠规则和原始值估一个控件类型：encode 时拿不到完整字段信息 */
function estimateKind(rule: FieldRule, raw: unknown): ControlKind {
  if (rule.kind && rule.kind !== "auto") return rule.kind;
  if (rule.options || rule.codec === "map") return "segmented";
  if (rule.min != null || rule.max != null) return "slider";
  if (typeof raw === "boolean") return "switch";
  const text = typeof raw === "string" ? raw.trim() : "";
  if (typeof raw === "number" || (text !== "" && Number.isFinite(Number(text)))) return "number";
  return "text";
}

/**
 * “auto” 表示听由控件类型选转换器：开关读布尔、滑块读数字。
 * 没配转换器时同样按这个规则补，避免 "26" 被当字符串读出来后面板只能干显示。
 */
function codecFor(kind: ControlKind, declared?: string) {
  if (declared && declared !== "auto") return declared;
  if (kind === "switch") return "shapebool";
  if (kind === "slider" || kind === "number") return "shapenum";
  return declared || "auto";
}

/** 档案 + 适配器 + 约束三者一起决定控件类型 */
function kindOf(field: VendorField, rule: FieldRule, options: ControlOption[], range: [number, number, number] | null, writable: boolean, value: unknown): ControlKind {
  const kind = pickKind(field, rule, options, range, value);
  /* 写不了的字段只能看，不能给一个拖得动的控件 */
  return writable || kind === "text" ? kind : "text";
}

function pickKind(field: VendorField, rule: FieldRule, options: ControlOption[], range: [number, number, number] | null, value: unknown): ControlKind {
  if (rule.kind && rule.kind !== "auto") return rule.kind;
  if (field.kind) return field.kind;
  if (options.length) return options.length <= 4 && flatNames(options) ? "segmented" : "select";
  if (typeof value === "boolean") return field.writable ? "switch" : "text";
  if (range) {
    const [min, max, step] = range;
    const integer = (step || 1) >= 1 && Number.isInteger(min) && Number.isInteger(max);
    return integer ? "slider" : "number";
  }
  if (typeof value === "number") return field.writable ? "number" : "text";
  return "text";
}

function resolveField(field: VendorField, rule: FieldRule, index: number, order: string[]): ResolvedField {
  const mapped = codecOptions(rule);
  const options = mapped.length ? mapped : field.options || [];
  const min = rule.min ?? field.range?.[0];
  const max = rule.max ?? field.range?.[1];
  const step = rule.step ?? field.range?.[2];
  const range: [number, number, number] | null =
    min != null || max != null ? [min ?? 0, max ?? (min ?? 0) + 100, step ?? 1] : field.range || null;
  const at = order.findIndex((pattern) => matchesPattern(pattern, field.key));
  const writable = rule.writable ?? field.writable;
  /* 先用原始值估出控件类型才能挑转换器，再用转换后的值修正一次 */
  const guess = kindOf(field, rule, options, range, writable, field.raw);
  const codec = getCodec(codecFor(guess, rule.codec));
  const ctx: CodecCtx = { raw: field.raw, meta: field.meta };
  const value = codec.decode(field.raw, rule.codecArgs || {}, ctx);
  return {
    key: field.key,
    label: rule.label || field.label || field.key.replace(/_/g, " "),
    kind: kindOf(field, rule, options, range, writable, value),
    unit: rule.unit ?? field.unit ?? "",
    writable,
    range,
    options,
    group: rule.group ?? field.group ?? "状态",
    value,
    raw: field.raw,
    order: rule.order ?? (at < 0 ? 1000 + index : at),
    siid: field.siid,
    piid: field.piid,
    meta: field.meta,
  };
}

/** 面板值的统一文本形式，首页的实时卡片和抽屉共用 */
export function formatPanelValue(prop: DeviceProperty): string {
  if (prop.value == null || prop.value === "") return "";
  const hit = prop.list.find((item) => String(item.value) === String(prop.value));
  if (hit) return hit.name;
  if (typeof prop.value === "boolean") return prop.value ? "开" : "关";
  const text = String(prop.value);
  return prop.unit && /^-?\d+(\.\d+)?$/.test(text) ? `${text}${prop.unit}` : text;
}

/**
 * 面板合成的唯一入口：适配器只提供原始字段，展示语义全部来自档案。
 * 输出沿用既有的 services / properties 结构，额外带上稳定的 id 与明确的 kind。
 */
export function buildPanel(device: DeviceSummary, fields: VendorField[], actions: VendorAction[] = []): DeviceDetail {
  const view = resolveProfile(device);
  const order = view.order();
  const groups = view.groups();
  const resolved = fields
    .map((field, index) => ({ field, rule: view.rule(field.key), index }))
    .filter(({ rule }) => !rule.hidden)
    .map(({ field, rule, index }) => resolveField(field, rule, index, order));

  const buckets = new Map<string, ResolvedField[]>();
  for (const item of resolved) {
    const list = buckets.get(item.group) || [];
    list.push(item);
    buckets.set(item.group, list);
  }
  const kept = actions
    .map((action, index) => ({ action, rule: view.action(action.key), index }))
    .filter(({ rule }) => !rule.hidden)
    .sort((a, b) => (a.rule.order ?? a.index) - (b.rule.order ?? b.index));

  /* 只有动作没有属性的分组（例如“打印”）也要占一个位置 */
  const names = new Set<string>(buckets.keys());
  for (const { action } of kept) names.add(action.group ?? "状态");
  const ordered = [...names].sort((a, b) => (groups[a]?.order ?? 100) - (groups[b]?.order ?? 100));
  const services: DeviceService[] = [];
  for (const name of ordered) {
    const items = (buckets.get(name) || []).slice().sort((a, b) => a.order - b.order);
    const siid = items.find((item) => item.siid != null)?.siid ?? services.length + 1;
    const properties: DeviceProperty[] = items.map((item, index) => ({
      id: item.key,
      siid,
      piid: item.piid ?? index + 1,
      name: item.label,
      kind: item.kind,
      unit: item.unit || undefined,
      writable: item.writable,
      range: item.range,
      list: item.options,
      value: item.value,
    }));
    const rows: DeviceAction[] = kept
      .filter(({ action }) => (action.group ?? "状态") === name)
      .map((row, index) => ({
        id: row.action.key,
        siid: row.action.siid ?? siid,
        aiid: row.action.aiid ?? index + 1,
        name: row.rule.label || row.action.name,
      }));
    if (!properties.length && !rows.length) continue;
    services.push({ siid, name: groups[name]?.name || name, properties, actions: rows });
  }
  return { device, services };
}

/**
 * 面板值 -> 设备写回值。
 * 用与读取时同一套“控件类型决定转换器”的规则，并把设备当前的原始值传给转换器，
 * shape 一类的转换器据此还原写回形态（"on" / "1" / 1 / true）。
 */
export function encodeFieldValue(device: DeviceSummary, key: string, value: unknown, ctx: CodecCtx = {}) {
  const rule = resolveRule(device, key);
  if (rule.hidden) throw new AppError(`字段 ${key} 已被面板配置隐藏`, "PROP", 400);
  const codec = getCodec(codecFor(estimateKind(rule, ctx.raw), rule.codec));
  return codec.encode(value, rule.codecArgs || {}, ctx);
}
