import { buildPanel, type VendorField } from "../../controls/index.js";
import { AppError } from "../../core/errors.js";
import type { DeviceDetail, DeviceSummary, PendingAuth, VendorProvider, VendorSession } from "../types.js";
import {
  formatLive,
  HOSTS,
  hostOf,
  loadMeters,
  loadUsage,
  loginByPassword,
  newDeviceState,
  sendDeviceCode,
  usageTable,
  type Meter,
  type SgccState,
} from "./api.js";

function stateOf(session: VendorSession) {
  const state = session.state as SgccState;
  if (!state?.token || !state.host) throw new AppError("国家电网账号未登录", "AUTH", 401);
  return state;
}

function summary(meter: Meter, state: SgccState): DeviceSummary {
  const usage = state.usage[meter.consNo];
  return {
    did: meter.consNo,
    vendorId: "sgcc",
    name: "智能电表",
    model: "sgcc.meter",
    online: true,
    room: "电表",
    icon: "",
    specType: "sgcc.meter",
    live: [
      { name: "当月电费", text: formatLive(usage?.monthAmt ?? null, "元") },
      { name: "当月用电", text: formatLive(usage?.monthPq ?? null, "kWh") },
    ],
  };
}

function remember(session: VendorSession, meters: Meter[]) {
  const state = stateOf(session);
  state.meters = meters;
  session.devices.clear();
  for (const meter of meters) session.devices.set(meter.consNo, summary(meter, state));
  return meters.map((meter) => summary(meter, state));
}

async function refreshMeters(session: VendorSession) {
  const state = stateOf(session);
  return remember(session, await loadMeters(state));
}

function findMeter(state: SgccState, did: string) {
  const meter = state.meters.find((item) => item.consNo === did);
  if (!meter) throw new AppError("户号不存在", "DEVICE", 404);
  return meter;
}

function numField(key: string, raw: number | null, group: string): VendorField {
  return { key, raw: raw == null ? "" : raw, writable: false, group };
}

export const sgccProvider: VendorProvider = {
  id: "sgcc",
  name: "国家电网",
  authModes: ["password"],
  listRegions() {
    return [{ id: "default", name: "网上国网" }];
  },
  createPending(region): PendingAuth {
    return {
      vendorId: "sgcc",
      region: HOSTS[region] ? region : "default",
      state: { host: hostOf(region), deviceState: newDeviceState() },
      createdAt: Date.now(),
    };
  },
  async loginPassword(pending, deviceCode = "") {
    const mobile = (pending.username || "").trim();
    const password = (pending.password || "").trim();
    if (!/^1\d{10}$/.test(mobile) || !password) throw new AppError("请填写网上国网手机号和密码", "AUTH", 400);
    const pendingState = pending.state as { host?: string; deviceState?: ReturnType<typeof newDeviceState>; codeKey?: string };
    const code = deviceCode.trim();
    if (pendingState.codeKey && !code) return { kind: "device" as const, pending };
    try {
      const state = await loginByPassword(
        mobile,
        password,
        pendingState.deviceState || newDeviceState(),
        code && pendingState.codeKey ? code : "",
        code && pendingState.codeKey ? pendingState.codeKey : "",
      );
      const session: VendorSession = {
        vendorId: "sgcc",
        userId: state.userId || mobile,
        region: pending.region || "default",
        devices: new Map(),
        state,
      };
      remember(session, state.meters);
      return { kind: "ok" as const, session };
    } catch (error) {
      if (!(error instanceof AppError) || String(error.code) !== "DEVICE") throw error;
      const deviceState = (error.details?.deviceState as ReturnType<typeof newDeviceState> | undefined) || pendingState.deviceState || newDeviceState();
      const sent = await sendDeviceCode(mobile, password, deviceState);
      pending.state = {
        host: pendingState.host || hostOf(pending.region),
        deviceState: sent.deviceState,
        codeKey: sent.codeKey,
      };
      return { kind: "device" as const, pending };
    }
  },
  async checkSession(session) {
    await refreshMeters(session);
  },
  async listDevices(session) {
    const state = stateOf(session);
    await refreshMeters(session);
    await Promise.all(state.meters.map(async (meter) => {
      try {
        await loadUsage(state, meter);
      } catch (error) {
        if (error instanceof AppError && error.code === "AUTH") throw error;
      }
    }));
    return remember(session, state.meters);
  },
  async refreshLive(session) {
    const state = stateOf(session);
    if (!state.meters.length) await refreshMeters(session);
    await Promise.all(state.meters.map(async (meter) => {
      try {
        await loadUsage(state, meter);
      } catch (error) {
        if (error instanceof AppError && error.code === "AUTH") throw error;
      }
    }));
    const devices = remember(session, state.meters);
    return Object.fromEntries(devices.map((device) => [device.did, device.live || []]));
  },
  async getDeviceDetail(session, did): Promise<DeviceDetail> {
    const state = stateOf(session);
    if (!state.meters.length) await refreshMeters(session);
    const meter = findMeter(state, did);
    const usage = await loadUsage(state, meter, true);
    const device = summary(meter, state);
    session.devices.set(meter.consNo, device);
    const fields: VendorField[] = [
      numField("monthPq", usage.monthPq, "本月"),
      numField("monthAmt", usage.monthAmt, "本月"),
      numField("balance", usage.balance, "本月"),
      numField("owe", usage.owe, "本月"),
      { key: "addr", raw: usage.addr || meter.addr || meter.consNo, writable: false, group: "本月" },
      { key: "dayTable", raw: usage.days.length, writable: false, kind: "table", group: "每日用电", table: usageTable(usage.days, "日期") },
      { key: "monthTable", raw: usage.months.length, writable: false, kind: "table", group: "每月用电", table: usageTable(usage.months, "月份") },
    ];
    return buildPanel(device, fields);
  },
  async setProperty() {
    throw new AppError("电表只读", "PROP", 400);
  },
  async runAction() {
    throw new AppError("电表没有可执行动作", "ACTION", 400);
  },
};
