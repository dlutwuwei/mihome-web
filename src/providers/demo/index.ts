import { buildPanel, encodeFieldValue, formatPanelValue, type VendorField } from "../../controls/index.js";
import { AppError } from "../../core/errors.js";
import type {
  DeviceDetail,
  DeviceSummary,
  LiveItem,
  PendingAuth,
  VendorProvider,
  VendorSession,
} from "../types.js";

type DemoState = { on: boolean; brightness: number };

/**
 * 示例厂商适配器：证明 Registry 可挂载多厂商。
 * 默认不注册；需要时在 bootstrap 里 registerVendor(demoProvider)。
 */
const DEMO_DEVICES: DeviceSummary[] = [
  {
    did: "demo-light-1",
    vendorId: "demo",
    name: "演示灯",
    model: "demo.light.v1",
    online: true,
    room: "客厅",
    icon: "",
  },
];

function sessionFrom(pending: PendingAuth): VendorSession {
  return {
    vendorId: "demo",
    userId: pending.username || "demo-user",
    region: pending.region || "cn",
    devices: new Map(DEMO_DEVICES.map((device) => [device.did, { ...device }])),
    state: { on: true, brightness: 70 },
  };
}

function stateOf(session: VendorSession): DemoState {
  return session.state as DemoState;
}

/** 演示厂商也只报事实：字段名 + 当前值，控件形态交给 demo-baseline 档案 */
function fieldsOf(state: DemoState): VendorField[] {
  return [
    { key: "on", raw: state.on, writable: true },
    { key: "brightness", raw: state.brightness, writable: true, range: [1, 100, 1] },
  ];
}

function liveOf(state: DemoState): LiveItem[] {
  const chips = buildPanel(DEMO_DEVICES[0], fieldsOf(state)).services.flatMap((service) => service.properties);
  return chips.flatMap((prop) => {
    const text = formatPanelValue(prop);
    return text ? [{ name: prop.name, text }] : [];
  });
}

export const demoProvider: VendorProvider = {
  id: "demo",
  name: "演示厂商",
  authModes: ["password"],
  listRegions() {
    return [{ id: "cn", name: "默认" }];
  },
  createPending(region) {
    return { vendorId: "demo", region, state: {}, createdAt: Date.now() };
  },
  async loginPassword(pending) {
    if (!pending.username || !pending.password) {
      throw new AppError("请填写账号和密码", "AUTH", 400);
    }
    if (pending.password !== "demo") {
      throw new AppError("演示账号密码为 demo", "AUTH", 400);
    }
    return { kind: "ok", session: sessionFrom(pending) };
  },
  async checkSession() {
    // 演示账号没有远端登录态，始终视为正常。
  },
  async listDevices(session) {
    const devices = [...session.devices.values()];
    const live = liveOf(stateOf(session));
    for (const device of devices) device.live = live;
    return devices;
  },
  async refreshLive(session) {
    return { "demo-light-1": liveOf(stateOf(session)) };
  },
  async getDeviceDetail(session, did): Promise<DeviceDetail> {
    const device = session.devices.get(did);
    if (!device) throw new AppError("设备不存在", "DEVICE", 404);
    return buildPanel(device, fieldsOf(stateOf(session)));
  },
  async setProperty(session, did, _siid, _piid, value, key?) {
    if (!session.devices.has(did)) throw new AppError("设备不存在", "DEVICE", 404);
    if (!key) throw new AppError("缺少字段名", "PROP", 400);
    const state = stateOf(session);
    const raw = encodeFieldValue(DEMO_DEVICES[0], key, value, { raw: state[key as keyof DemoState] });
    if (key === "on") state.on = Boolean(raw);
    if (key === "brightness") state.brightness = Number(raw);
  },
  async runAction() {
    throw new AppError("演示厂商暂无动作", "ACTION", 400);
  },
};
