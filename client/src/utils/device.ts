import type { ControlKind, Device, DeviceProp, LiveChip } from "../types";

export function unitOf(prop: DeviceProp) {
  if (prop.unit) return prop.unit;
  const name = prop.name;
  if (/亮度|湿度|电量|温度设置|brightness|humidity|battery/i.test(name)) return "%";
  if (/色温|color.?temperature/i.test(name)) return "K";
  if (/温度|temperature/i.test(name)) return "°";
  return "";
}

export function withUnit(prop: DeviceProp, value: unknown) {
  const text = String(value);
  const unit = unitOf(prop);
  if (!unit || !/^-?\d+(\.\d+)?$/.test(text)) return text;
  return `${text}${unit}`;
}

export function showValue(prop: DeviceProp) {
  if (prop.value == null) return "—";
  const hit = prop.list.find((item) => item.value === prop.value);
  if (hit) return hit.name;
  if (isBooleanish(prop)) return prop.value ? "开" : "关";
  if (typeof prop.value === "number" && unitOf(prop)) return withUnit(prop, prop.value);
  return String(prop.value);
}

/** 布尔语义：服务端标了 switch、厂商给的是 bool，或当前值就是布尔 */
function isBooleanish(prop: DeviceProp) {
  return prop.kind === "switch" || prop.format === "bool" || typeof prop.value === "boolean";
}

export type { ControlKind };

/** 服务端下发的 kind 优先；没有 kind 的旧返回才按 format / list / range 兼容推断 */
export function controlKind(prop: DeviceProp): ControlKind {
  if (prop.kind) return prop.kind;
  if (!prop.writable) return "text";
  if (isBooleanish(prop)) return prop.list.length ? listKind(prop) : "switch";
  if (prop.list.length) return listKind(prop);
  if (prop.range) {
    const [min, max, step] = prop.range;
    const integer = (step || 1) >= 1 && Number.isInteger(min) && Number.isInteger(max);
    return prop.format === "float" || !integer ? "number" : "slider";
  }
  if (prop.format === "int" || prop.format === "float") return "number";
  return "text";
}

function listKind(prop: DeviceProp): ControlKind {
  const flat = prop.list.every((item) => String(item.name).replace(/\s/g, "").length <= 6);
  return prop.list.length <= 4 && flat ? "segmented" : "select";
}

export function deviceKey(device: Pick<Device, "accountId" | "did">) {
  return `${device.accountId}:${device.did}`;
}

export function mergeLive(devices: Device[], live: Record<string, LiveChip[]>) {
  return devices.map((device) => {
    const next = live[deviceKey(device)];
    return next ? { ...device, live: next } : device;
  });
}

export function devicePath(accountId: string, did: string) {
  return `/api/devices/${encodeURIComponent(accountId)}/${encodeURIComponent(did)}`;
}
