import { AppError } from "../../core/errors.js";
import { buildPanel, encodeFieldValue, formatPanelValue, type VendorField } from "../../controls/index.js";
import type { DeviceDetail, DeviceSummary, LiveItem, VendorSession } from "../types.js";
import { mas, sessionState } from "./api.js";
import { decryptSn } from "./crypto.js";

const STATUS_PATH = "/v1/device/status/lua/get";
const CONTROL_PATH = "/v1/device/lua/control";

/** 布尔形态的字段可以直接当命令用；其余字段能不能写由面板档案决定 */
function boolShape(value: unknown) {
  if (typeof value === "boolean") return true;
  if (value === "on" || value === "off" || value === "0" || value === "1") return true;
  return value === 0 || value === 1;
}

/** 适配器只描述事实：字段名、原始值、值本身透露出的形态 */
function fieldsOf(status: Record<string, unknown>): VendorField[] {
  return Object.entries(status).flatMap<VendorField>(([key, value]) => {
    if (!["string", "number", "boolean"].includes(typeof value)) return [];
    if (value === "" || value === "nonexistence") return [];
    const command = boolShape(value);
    return [{
      key,
      raw: value,
      writable: command,
      kind: command ? "switch" : undefined,
      meta: { asText: typeof value === "string" },
    }];
  });
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

async function readStatus(state: ReturnType<typeof sessionState>, did: string) {
  const data = await mas(state, STATUS_PATH, {
    applianceCode: did,
    command: { query: {} },
  });
  const status = asRecord(data.status) || asRecord(data.result) || data;
  return status as Record<string, unknown>;
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

function requireToken(state: ReturnType<typeof sessionState>) {
  if (!state.accessToken) {
    throw new AppError("登录凭证已缺失，请重新登录", "AUTH", 401);
  }
}

/** 轻量请求家庭列表，确认登录态仍被接受。 */
export async function checkSession(session: VendorSession) {
  const state = sessionState(session.state);
  requireToken(state);
  await mas(state, "/v1/homegroup/list/get", {});
}

export async function listDevices(session: VendorSession) {
  const state = sessionState(session.state);
  requireToken(state);
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
      state.raw.set(device.did, status);
      const chips = buildPanel(device, fieldsOf(status)).services.flatMap((service) => service.properties).slice(0, 4);
      live[device.did] = chips.flatMap((prop) => {
        const text = formatPanelValue(prop);
        return text ? [{ name: prop.name, text }] : [];
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
  state.raw.set(did, status);
  return buildPanel(device, fieldsOf(status));
}

export async function setProperty(
  session: VendorSession,
  did: string,
  _siid: number,
  _piid: number,
  value: unknown,
  key?: string,
) {
  const device = session.devices.get(did);
  if (!device) throw new AppError("请先刷新设备列表", "DEVICE", 404);
  if (!key) throw new AppError("缺少字段名", "PROP", 400);
  const state = sessionState(session.state);
  const raw = encodeFieldValue(device, key, value, { raw: state.raw.get(did)?.[key] });
  await mas(state, CONTROL_PATH, {
    applianceCode: did,
    command: { control: { [key]: raw } },
  });
}

export async function runAction() {
  throw new AppError("该设备没有可执行动作", "ACTION", 400);
}
