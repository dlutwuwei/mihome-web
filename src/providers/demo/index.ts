import { AppError } from "../../core/errors.js";
import type {
  DeviceDetail,
  DeviceSummary,
  PendingAuth,
  VendorProvider,
  VendorSession,
} from "../types.js";

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
    live: [{ name: "开关", text: "开" }, { name: "亮度", text: "70%" }],
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
  async listDevices(session) {
    const devices = [...session.devices.values()];
    return devices;
  },
  async refreshLive(session) {
    const state = session.state as { on: boolean; brightness: number };
    const live = {
      "demo-light-1": [
        { name: "开关", text: state.on ? "开" : "关" },
        { name: "亮度", text: `${state.brightness}%` },
      ],
    };
    return live;
  },
  async getDeviceDetail(session, did): Promise<DeviceDetail> {
    const device = session.devices.get(did);
    if (!device) throw new AppError("设备不存在", "DEVICE", 404);
    const state = session.state as { on: boolean; brightness: number };
    return {
      device,
      services: [
        {
          siid: 2,
          name: "灯光",
          properties: [
            {
              siid: 2,
              piid: 1,
              name: "开关",
              format: "bool",
              writable: true,
              range: null,
              list: [],
              value: state.on,
            },
            {
              siid: 2,
              piid: 2,
              name: "亮度",
              format: "uint8",
              writable: true,
              range: [1, 100, 1],
              list: [],
              value: state.brightness,
            },
          ],
          actions: [],
        },
      ],
    };
  },
  async setProperty(session, did, _siid, piid, value) {
    if (!session.devices.has(did)) throw new AppError("设备不存在", "DEVICE", 404);
    const state = session.state as { on: boolean; brightness: number };
    if (piid === 1) state.on = Boolean(value);
    if (piid === 2) state.brightness = Number(value);
  },
  async runAction() {
    throw new AppError("演示厂商暂无动作", "ACTION", 400);
  },
};
