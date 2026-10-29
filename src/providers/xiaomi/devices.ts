import { AppError } from "../../core/errors.js";
import type {
  DeviceDetail,
  DeviceProperty,
  DeviceService,
  DeviceSummary,
  LiveItem,
  VendorSession,
} from "../types.js";
import { apiCall, sessionState } from "./api.js";
import { labelOf, scoreLive, UNITS, zh } from "./labels.js";

const specCache = new Map<string, Record<string, unknown>>();

type SpecProp = {
  iid: number;
  type?: string;
  description?: string;
  format?: string;
  access?: string[];
  unit?: string;
  "value-range"?: number[];
  "value-list"?: Array<{ value: string | number | boolean; description?: string }>;
};

type SpecService = {
  iid: number;
  type?: string;
  description?: string;
  properties?: SpecProp[];
  actions?: Array<{ iid: number; description?: string; in?: unknown[] }>;
};

type SpecDoc = { services?: SpecService[] };

async function specOf(type?: string) {
  if (!type) return null;
  if (specCache.has(type)) return specCache.get(type) as SpecDoc;
  const response = await fetch(`https://miot-spec.org/miot-spec-v2/instance?type=${encodeURIComponent(type)}`);
  if (!response.ok) return null;
  const body = (await response.json()) as SpecDoc;
  specCache.set(type, body as unknown as Record<string, unknown>);
  return body;
}

function roomIndex(home: Record<string, unknown>) {
  const map = new Map<string, string>();
  const rooms = (home.roomlist || home.room_list || []) as Array<{ name?: string; dids?: string[] }>;
  for (const room of rooms) {
    for (const did of room.dids || []) map.set(String(did), room.name || "");
  }
  return map;
}

function publicDevice(raw: Record<string, unknown>, room: string): DeviceSummary {
  return {
    did: String(raw.did || ""),
    vendorId: "xiaomi",
    name: String(raw.name || raw.model || raw.did || ""),
    model: String(raw.model || ""),
    online: Boolean(raw.isOnline),
    room: room || "",
    icon: typeof raw.icon_url === "string" ? raw.icon_url : "",
    specType: typeof raw.spec_type === "string" ? raw.spec_type : "",
  };
}

function livePropsFromSpec(spec: SpecDoc | null) {
  const all = [];
  for (const service of spec?.services || []) {
    if (String(service.type || "").includes("device-information")) continue;
    for (const prop of service.properties || []) {
      const access = prop.access || [];
      if (!access.includes("read") || prop.format === "string") continue;
      const urn = String(prop.type || "").toLowerCase();
      const desc = String(prop.description || "").toLowerCase();
      const score = scoreLive(urn, desc);
      all.push({
        score,
        siid: service.iid,
        piid: prop.iid,
        name: labelOf(prop.description),
        format: prop.format || "",
        unit: UNITS[prop.unit || ""] || "",
        list: (prop["value-list"] || []).map((item) => ({
          value: item.value,
          name: zh(item.description) || String(item.value),
        })),
        bool: prop.format === "bool" || Boolean(prop["value-list"]?.length),
      });
    }
  }
  let picked = all.filter((prop) => prop.score > 0).sort((a, b) => b.score - a.score);
  if (!picked.length) picked = all.filter((prop) => prop.bool);
  return picked.slice(0, 4);
}

function formatLive(prop: { format: string; unit: string; list: Array<{ value: unknown; name: string }> }, value: unknown) {
  if (value == null) return "";
  if (prop.format === "bool") return value ? "开" : "关";
  const hit = prop.list.find((item) => item.value === value || String(item.value) === String(value));
  if (hit) return hit.name;
  if (typeof value === "number") return prop.unit ? `${value}${prop.unit}` : String(value);
  return zh(value) || String(value);
}

async function readProps(state: unknown, params: Array<{ did: string; siid: number; piid: number }>) {
  const auth = sessionState(state);
  const values = new Map<string, { did: string; siid: number; piid: number; code: number; value?: unknown }>();
  for (let i = 0; i < params.length; i += 16) {
    const chunk = params.slice(i, i + 16);
    const result = (await apiCall(auth, "/miotspec/prop/get", { params: chunk })) as Array<{
      did: string;
      siid: number;
      piid: number;
      code: number;
      value?: unknown;
    }>;
    for (const row of result || []) values.set(`${row.did}:${row.siid}:${row.piid}`, row);
  }
  return values;
}

function controlsFromSpec(spec: SpecDoc | null): DeviceService[] {
  const services: DeviceService[] = [];
  for (const service of spec?.services || []) {
    if (String(service.type || "").includes("device-information")) continue;
    const properties: DeviceProperty[] = [];
    for (const prop of service.properties || []) {
      const access = prop.access || [];
      if (!access.includes("read")) continue;
      properties.push({
        siid: service.iid,
        piid: prop.iid,
        name: labelOf(prop.description),
        format: prop.format || "",
        writable: access.includes("write"),
        range: prop["value-range"] || null,
        list: (prop["value-list"] || []).map((item) => ({
          value: item.value,
          name: zh(item.description) || String(item.value),
        })),
      });
    }
    const actions = [];
    for (const action of service.actions || []) {
      if ((action.in || []).length) continue;
      actions.push({ siid: service.iid, aiid: action.iid, name: labelOf(action.description) });
    }
    if (properties.length || actions.length) {
      services.push({
        siid: service.iid,
        name: labelOf(service.description),
        properties,
        actions,
      });
    }
  }
  return services;
}

export async function listDevices(session: VendorSession): Promise<DeviceSummary[]> {
  const auth = sessionState(session.state);
  const homesResult = (await apiCall(auth, "/v2/homeroom/gethome", {
    fg: true,
    fetch_share: true,
    fetch_share_dev: true,
    limit: 300,
    app_ver: 7,
  })) as { homelist?: Array<Record<string, unknown>>; partition?: Array<{ homelist?: Array<Record<string, unknown>> }> };
  let homes = homesResult?.homelist || [];
  if (!homes.length && Array.isArray(homesResult?.partition)) {
    homes = homesResult.partition.flatMap((part) => part.homelist || []);
  }
  const devices: DeviceSummary[] = [];
  const seen = new Set<string>();
  for (const home of homes) {
    const homeId = home.id ?? home.home_id;
    if (homeId == null) continue;
    const rooms = roomIndex(home);
    const list = (await apiCall(auth, "/v2/home/home_device_list", {
      home_owner: String(auth.userId),
      home_id: String(homeId),
      limit: 200,
      get_split_device: true,
      support_smart_home: true,
    })) as { device_info?: Array<Record<string, unknown>>; list?: Array<Record<string, unknown>> };
    const rows = list?.device_info || list?.list || [];
    for (const device of rows) {
      const did = String(device.did || "");
      if (!did || seen.has(did)) continue;
      seen.add(did);
      devices.push(publicDevice(device, rooms.get(did) || String(home.name || "")));
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
  const plans: Array<{ did: string; siid: number; piid: number }> = [];
  const chosen = new Map<string, ReturnType<typeof livePropsFromSpec>>();
  for (const device of devices) {
    const spec = await specOf(device.specType);
    const props = livePropsFromSpec(spec);
    chosen.set(device.did, props);
    for (const prop of props) plans.push({ did: device.did, siid: prop.siid, piid: prop.piid });
  }
  const values = plans.length ? await readProps(session.state, plans) : new Map();
  const live: Record<string, LiveItem[]> = {};
  for (const device of devices) {
    live[device.did] = (chosen.get(device.did) || []).flatMap((prop) => {
      const row = values.get(`${device.did}:${prop.siid}:${prop.piid}`);
      if (!row || row.code !== 0) return [];
      const text = formatLive(prop, row.value);
      return text ? [{ name: prop.name, text }] : [];
    });
  }
  return live;
}

export async function getDeviceDetail(session: VendorSession, did: string): Promise<DeviceDetail> {
  const device = session.devices.get(did);
  if (!device) throw new AppError("请先刷新设备列表", "DEVICE", 404);
  const spec = await specOf(device.specType);
  const services = controlsFromSpec(spec);
  const params = [];
  for (const service of services) {
    for (const prop of service.properties) params.push({ did: device.did, siid: prop.siid, piid: prop.piid });
  }
  const values = await readProps(session.state, params);
  for (const service of services) {
    for (const prop of service.properties) {
      const row = values.get(`${device.did}:${prop.siid}:${prop.piid}`);
      prop.value = row && row.code === 0 ? row.value : null;
      prop.error = row && row.code !== 0 ? row.code : 0;
    }
  }
  return { device, services };
}

export async function setProperty(session: VendorSession, did: string, siid: number, piid: number, value: unknown) {
  const device = session.devices.get(did);
  if (!device) throw new AppError("请先刷新设备列表", "DEVICE", 404);
  const auth = sessionState(session.state);
  const result = await apiCall(auth, "/miotspec/prop/set", {
    params: [{ did: device.did, siid, piid, value }],
  });
  const row = Array.isArray(result) ? result[0] : result;
  if (row && typeof row === "object" && "code" in row && (row as { code: number }).code) {
    throw new AppError(`设备返回 ${(row as { code: number }).code}`, (row as { code: number }).code, 400);
  }
}

export async function runAction(session: VendorSession, did: string, siid: number, aiid: number) {
  const device = session.devices.get(did);
  if (!device) throw new AppError("请先刷新设备列表", "DEVICE", 404);
  const auth = sessionState(session.state);
  const result = (await apiCall(auth, "/miotspec/action", {
    params: { did: device.did, siid, aiid, in: [] },
  })) as { code?: number } | null;
  if (result?.code) throw new AppError(`设备返回 ${result.code}`, result.code, 400);
}
