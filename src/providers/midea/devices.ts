import { AppError } from "../../core/errors.js";
import type { DeviceDetail, DeviceProperty, DeviceSummary, LiveItem, VendorSession } from "../types.js";
import { mas, sessionState } from "./api.js";
import { decryptSn } from "./crypto.js";
import type { MideaField } from "./state.js";

const LABELS: Record<string, string> = {
  power: "开关",
  poweron: "开关",
  mode: "模式",
  temperature: "温度",
  targettemperature: "目标温度",
  indoortemperature: "室内温度",
  outdoortemperature: "室外温度",
  humidity: "湿度",
  windspeed: "风速",
  fanspeed: "风速",
};

const PREFERRED = ["power", "poweron", "mode", "temperature", "targettemperature", "indoortemperature", "humidity"];

function labelOf(key: string) {
  return LABELS[key.toLowerCase()] || key;
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function textOf(value: unknown) {
  if (typeof value === "boolean") return value ? "开" : "关";
  if (value === "on" || value === "1") return "开";
  if (value === "off" || value === "0") return "关";
  if (value == null) return "";
  return String(value);
}

function boolStyle(value: unknown): MideaField["boolStyle"] {
  if (typeof value === "boolean") return "bool";
  if (value === "on" || value === "off") return "onoff";
  if (value === "0" || value === "1") return "zo";
  if (value === 0 || value === 1) return "num";
  return "";
}

function isWritable(key: string) {
  const name = key.toLowerCase();
  if (name.includes("indoor") || name.includes("outdoor") || name.includes("humidity")) return false;
  return name === "power" || name === "poweron" || name.includes("temperature") || name.includes("wind") || name.includes("fan");
}

const SKIP = new Set(["reqId", "stamp", "requestId", "applianceCode", "command", "message", "msg", "code"]);

function fieldsFrom(status: Record<string, unknown>) {
  const keys = Object.keys(status).filter((key) => {
    if (SKIP.has(key)) return false;
    const value = status[key];
    return value == null || ["string", "number", "boolean"].includes(typeof value);
  });
  keys.sort((a, b) => {
    const ia = PREFERRED.indexOf(a.toLowerCase());
    const ib = PREFERRED.indexOf(b.toLowerCase());
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return keys.map((key) => ({ key, style: boolStyle(status[key]) }));
}

function propertyOf(key: string, value: unknown, index: number): DeviceProperty {
  const style = boolStyle(value);
  const name = key.toLowerCase();
  const numeric = typeof value === "number" || (typeof value === "string" && value !== "" && !Number.isNaN(Number(value)));
  const temp = name.includes("temperature") && !name.includes("indoor") && !name.includes("outdoor");
  return {
    siid: 1,
    piid: index,
    name: labelOf(key),
    format: style ? "bool" : numeric ? "number" : "string",
    writable: Boolean(style) ? isWritable(key) : temp && numeric,
    range: temp && numeric ? [16, 30, 1] : null,
    list: [],
    value: style ? value === true || value === "on" || value === "1" || value === 1 : numeric && temp ? Number(value) : value,
  };
}

async function readStatus(state: ReturnType<typeof sessionState>, did: string) {
  const data = await mas(state, "/mjl/v1/device/status/lua/get", {
    applianceCode: did,
    command: { query: {} },
  });
  return asRecord(data.status) || asRecord(data.result) || data;
}

function roomDevices(home: Record<string, unknown>, roomName: string) {
  const rooms = (home.roomList || home.roomlist || []) as Array<Record<string, unknown>>;
  const rows: Array<{ raw: Record<string, unknown>; room: string }> = [];
  for (const room of rooms) {
    const name = String(room.name || room.roomName || roomName);
    const list = (room.applianceList || room.appliance_list || []) as Array<Record<string, unknown>>;
    for (const raw of list || []) rows.push({ raw, room: name });
  }
  const loose = (home.applianceList || []) as Array<Record<string, unknown>>;
  for (const raw of loose) rows.push({ raw, room: roomName });
  return rows;
}

function summaryOf(raw: Record<string, unknown>, room: string, sessionKey: Buffer | null): DeviceSummary | null {
  const did = String(raw.applianceCode || raw.id || "");
  if (!did) return null;
  const sn8 = String(raw.sn8 || "");
  const sn = typeof raw.sn === "string" ? decryptSn(raw.sn, sessionKey) : "";
  const model = String(raw.productModel || raw.modelNumber || sn8 || (sn.length > 17 ? sn.slice(9, 17) : "") || raw.type || "");
  const icon = [raw.productImg, raw.icon, raw.iconUrl, raw.deviceIcon].find((item) => typeof item === "string" && item.startsWith("http"));
  return {
    did,
    vendorId: "midea",
    name: String(raw.name || model || did),
    model,
    online: String(raw.onlineStatus ?? raw.online ?? "") === "1" || raw.onlineStatus === 1 || raw.online === true,
    room,
    icon: typeof icon === "string" ? icon : "",
  };
}

export async function listDevices(session: VendorSession) {
  const state = sessionState(session.state);
  const homes = await mas(state, "/v1/homegroup/list/get", {});
  const homeList = (homes.homeList || homes.homegroupList || []) as Array<Record<string, unknown>>;
  const devices: DeviceSummary[] = [];
  const seen = new Set<string>();
  for (const home of homeList) {
    const homeId = home.homegroupId ?? home.id;
    if (homeId == null || homeId === "") continue;
    const listed = await mas(state, "/v1/appliance/home/list/get", { homegroupId: homeId });
    const groups = (listed.homeList || [listed]) as Array<Record<string, unknown>>;
    for (const group of groups) {
      for (const item of roomDevices(group, String(home.name || home.homeName || ""))) {
        const device = summaryOf(item.raw, item.room || String(home.name || home.homeName || ""), state.sessionKey);
        if (!device || seen.has(device.did)) continue;
        seen.add(device.did);
        devices.push(device);
      }
    }
  }
  if (!devices.length) {
    const listed = await mas(state, "/v1/appliance/user/list/get", {});
    for (const raw of (listed.list || []) as Array<Record<string, unknown>>) {
      const device = summaryOf(raw, "", state.sessionKey);
      if (!device || seen.has(device.did)) continue;
      seen.add(device.did);
      devices.push(device);
    }
  }
  session.devices = new Map(devices.map((device) => [device.did, device]));
  try {
    const live = await refreshLive(session, devices);
    for (const device of devices) device.live = live[device.did] || [];
  } catch {
    for (const device of devices) device.live = device.live || [];
  }
  return devices;
}

export async function refreshLive(session: VendorSession, devices: DeviceSummary[]) {
  const state = sessionState(session.state);
  const live: Record<string, LiveItem[]> = {};
  await Promise.all(devices.map(async (device) => {
    try {
      const status = await readStatus(state, device.did);
      const fields = fieldsFrom(status).slice(0, 4);
      live[device.did] = fields.flatMap(({ key }) => {
        const text = textOf(status[key]);
        return text ? [{ name: labelOf(key), text }] : [];
      });
    } catch {
      live[device.did] = [];
    }
  }));
  return live;
}

export async function getDeviceDetail(session: VendorSession, did: string): Promise<DeviceDetail> {
  const device = session.devices.get(did);
  if (!device) throw new AppError("请先刷新设备列表", "DEVICE", 404);
  const state = sessionState(session.state);
  const status = await readStatus(state, did);
  const rows = fieldsFrom(status);
  state.fields.set(did, rows.map((row) => ({ key: row.key, boolStyle: row.style })));
  const properties = rows.map((row, index) => propertyOf(row.key, status[row.key], index));
  return {
    device,
    services: properties.length ? [{ siid: 1, name: "状态", properties, actions: [] }] : [],
  };
}

function controlValue(field: MideaField, value: unknown) {
  if (field.boolStyle === "onoff") return value ? "on" : "off";
  if (field.boolStyle === "zo") return value ? "1" : "0";
  if (field.boolStyle === "num") return value ? 1 : 0;
  if (field.boolStyle === "bool") return Boolean(value);
  return value;
}

export async function setProperty(session: VendorSession, did: string, _siid: number, piid: number, value: unknown) {
  const state = sessionState(session.state);
  const field = state.fields.get(did)?.[piid];
  if (!field) throw new AppError("请先打开设备", "DEVICE", 400);
  await mas(state, "/mjl/v1/device/lua/control", {
    applianceCode: did,
    command: { control: { [field.key]: controlValue(field, value) } },
  });
}

export async function runAction() {
  throw new AppError("该设备没有可执行动作", "ACTION", 400);
}
