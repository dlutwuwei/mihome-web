import { AppError } from "../../core/errors.js";
import type { DeviceDetail, DeviceProperty, DeviceSummary, LiveItem, VendorSession } from "../types.js";
import { mas, sessionState } from "./api.js";
import { decryptSn } from "./crypto.js";
import type { MideaField } from "./state.js";

const LABELS: Record<string, string> = {
  power: "开关",
  poweron: "开关",
  mode: "模式",
  program: "程序",
  temperature: "温度",
  targettemperature: "目标温度",
  indoortemperature: "室内温度",
  outdoortemperature: "室外温度",
  humidity: "湿度",
  windspeed: "风速",
  fanspeed: "风速",
  running_status: "状态",
  remain_time: "剩余时间",
  progress: "进度",
  error_code: "故障",
  lock: "童锁",
  water_level: "水位",
  memory: "记忆",
  spray_wash: "喷淋",
  nightly: "夜间",
  down_light: "筒灯",
  easy_ironing: "免熨",
  beforehand_wash: "预洗",
  intelligent_wash: "智能洗",
  strong_wash: "强力",
  steam_wash: "蒸汽",
  fast_clean_wash: "速净",
  super_clean_wash: "超净",
  soak: "浸泡",
  speedy: "快速",
  dehydration_speed: "脱水转速",
  appointment: "预约",
  storage_temperature: "冷藏温度",
  freezing_temperature: "冷冻温度",
  left_flexzone_temperature: "左变温",
  right_flexzone_temperature: "右变温",
  storage_power: "冷藏开关",
  freezing_power: "冷冻开关",
  left_flexzone_power: "左变温开关",
  right_flexzone_power: "右变温开关",
  function_zone_power: "功能区开关",
  all_refrigeration_power: "全冷藏",
  storage_mode: "冷藏模式",
  freezing_mode: "冷冻模式",
  intelligent_mode: "智能模式",
  holiday_mode: "假日模式",
  variable_mode: "变温模式",
};

const VALUES: Record<string, string> = {
  mixed_wash: "混合洗",
  normal: "标准",
  idle: "待机",
  auto: "自动",
  partial_freezing_mode: "微冻",
};

const PREFERRED = [
  "power",
  "poweron",
  "program",
  "mode",
  "temperature",
  "storage_power",
  "freezing_power",
  "storage_temperature",
  "freezing_temperature",
  "running_status",
  "remain_time",
];

const STATUS_PATH = "/v1/device/status/lua/get";
const CONTROL_PATH = "/v1/device/lua/control";

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
  if (value == null || value === "nonexistence") return "";
  const text = String(value);
  return VALUES[text] || text;
}

function boolStyle(value: unknown): MideaField["boolStyle"] {
  if (typeof value === "boolean") return "bool";
  if (value === "on" || value === "off") return "onoff";
  if (value === "0" || value === "1") return "zo";
  if (value === 0 || value === 1) return "num";
  return "";
}

function isHidden(key: string, value: unknown) {
  if (value == null || value === "" || value === "nonexistence") return true;
  const name = key.toLowerCase();
  if (/door|real_temperature|humidity|expire|consumption|fahrenheit|motor_|human_induction|food_site|version|project_no|data_type|expert_step|minute$/.test(name)) return true;
  if (/beef|pork|mutton|chicken|fish|shrimp|dumpling|duck_meat|ice_cream|gluepudding/.test(name)) return true;
  return false;
}

function isReadout(key: string) {
  const name = key.toLowerCase();
  return /error|remain_time|progress|running_status|wash_time$|dehydration_time$|appointment_time|status$|unit$/.test(name);
}

function isSetpoint(key: string) {
  const name = key.toLowerCase();
  if (!name.includes("temperature") && !name.includes("wind") && !name.includes("fan")) return false;
  return !/real|unit|fahrenheit|status|indoor|outdoor|humidity/.test(name);
}

function rangeOf(key: string, value: number): [number, number, number] {
  const name = key.toLowerCase();
  if (name === "temperature" || name.includes("wind") || name.includes("fan")) return [0, 95, 1];
  if (name.includes("freezing") && !name.includes("flex")) return [-24, -12, 1];
  if (name.includes("storage") || name.includes("refrigerat")) return [2, 8, 1];
  if (name.includes("flex") || name.includes("variable")) return [-20, 10, 1];
  if (value <= 0) return [-24, 10, 1];
  return [2, 30, 1];
}

const SKIP = new Set(["reqId", "stamp", "requestId", "applianceCode", "command", "message", "msg", "code"]);

function isCommand(key: string, value: unknown) {
  const style = boolStyle(value);
  if (isReadout(key) || isHidden(key, value)) return false;
  return style === "bool" || style === "onoff";
}

function fieldsFrom(status: Record<string, unknown>) {
  const keys = Object.keys(status).filter((key) => {
    if (SKIP.has(key) || isHidden(key, status[key])) return false;
    const value = status[key];
    if (!["string", "number", "boolean"].includes(typeof value)) return false;
    return isCommand(key, value) || isSetpoint(key) || PREFERRED.includes(key.toLowerCase()) || isReadout(key);
  });
  keys.sort((a, b) => {
    const rank = (key: string) => {
      const writable = isCommand(key, status[key]) || isSetpoint(key);
      const preferred = PREFERRED.indexOf(key.toLowerCase());
      return (writable ? 0 : 50) + (preferred < 0 ? 40 : preferred);
    };
    return rank(a) - rank(b);
  });
  return keys.map((key) => ({
    key,
    style: boolStyle(status[key]),
    asText: typeof status[key] === "string",
  }));
}

function propertyOf(key: string, value: unknown, index: number): DeviceProperty {
  const style = boolStyle(value);
  const numeric = typeof value === "number" || (typeof value === "string" && value !== "" && !Number.isNaN(Number(value)) && style !== "zo");
  const setpoint = isSetpoint(key) && numeric;
  const command = isCommand(key, value);
  const numberValue = typeof value === "number" ? value : Number(value);
  const shown = VALUES[String(value)] || value;
  return {
    siid: 1,
    piid: index,
    name: labelOf(key),
    format: command ? "bool" : setpoint ? "number" : "string",
    writable: command || setpoint,
    range: setpoint ? rangeOf(key, numberValue) : null,
    list: [],
    value: command ? value === true || value === "on" || value === "1" || value === 1 : setpoint ? numberValue : shown,
  };
}

async function readStatus(state: ReturnType<typeof sessionState>, did: string) {
  const data = await mas(state, STATUS_PATH, {
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
      const present = new Map(Object.keys(status).map((key) => [key.toLowerCase(), key]));
      const picked = PREFERRED.flatMap((name) => {
        const key = present.get(name);
        if (!key || isHidden(key, status[key])) return [];
        const text = textOf(status[key]);
        return text ? [{ name: labelOf(key), text }] : [];
      }).slice(0, 4);
      live[device.did] = picked;
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
  state.fields.set(did, rows.map((row) => ({ key: row.key, boolStyle: row.style, asText: row.asText })));
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
  if (field.asText) return String(value);
  return value;
}

export async function setProperty(session: VendorSession, did: string, _siid: number, piid: number, value: unknown) {
  const state = sessionState(session.state);
  const field = state.fields.get(did)?.[piid];
  if (!field) throw new AppError("请先打开设备", "DEVICE", 400);
  await mas(state, CONTROL_PATH, {
    applianceCode: did,
    command: { control: { [field.key]: controlValue(field, value) } },
  });
}

export async function runAction() {
  throw new AppError("该设备没有可执行动作", "ACTION", 400);
}
