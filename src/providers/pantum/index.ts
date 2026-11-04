import { AppError } from "../../core/errors.js";
import type { DeviceDetail, DeviceSummary, VendorProvider, VendorSession } from "../types.js";
import { listBindDevices, loginByPhone, printCloudFile, printOptionsFrom, sendLoginCode, type CloudDevice, type CloudSession } from "./cloud.js";

interface PantumState extends CloudSession {
  devices: CloudDevice[];
}

function stateOf(session: VendorSession) {
  const state = session.state as PantumState;
  if (!state?.token) throw new AppError("奔图账号未登录", "AUTH", 401);
  return state;
}

function summary(device: CloudDevice): DeviceSummary {
  return {
    did: device.did,
    vendorId: "pantum",
    name: device.name,
    model: device.model,
    online: device.online,
    room: "云打印",
    icon: "",
    live: [
      { name: "序列号", text: device.sn },
      { name: "打印", text: device.online ? "云端在线" : "云端离线" },
    ],
  };
}

async function refresh(session: VendorSession) {
  const state = stateOf(session);
  state.devices = await listBindDevices(state.token);
  session.devices.clear();
  for (const device of state.devices) session.devices.set(device.did, summary(device));
  return state.devices.map(summary);
}

function findDevice(session: VendorSession, did: string) {
  const device = stateOf(session).devices.find((item) => item.did === did);
  if (!device) throw new AppError("设备不存在", "DEVICE", 404);
  return device;
}

export async function printFile(session: VendorSession, did: string, body: Buffer, mime: string, filename: string, fields: Record<string, string>) {
  const state = stateOf(session);
  const device = findDevice(session, did);
  await printCloudFile(state.token, device, body, mime, filename, printOptionsFrom(fields));
}

export const pantumProvider: VendorProvider = {
  id: "pantum",
  name: "奔图",
  authModes: ["sms"],
  listRegions() {
    return [{ id: "cn", name: "中国大陆" }];
  },
  createPending(region) {
    return { vendorId: "pantum", region, state: {}, createdAt: Date.now() };
  },
  async loginPassword() {
    throw new AppError("请使用短信验证码登录", "AUTH", 400);
  },
  async sendSms(pending) {
    const mobile = (pending.username || "").trim();
    if (!/^1\d{10}$/.test(mobile)) throw new AppError("请填写奔图账号手机号", "AUTH", 400);
    await sendLoginCode(mobile);
    return { needCaptcha: false };
  },
  async loginSms(pending) {
    const mobile = (pending.username || "").trim();
    const verifyCode = (pending.password || "").trim();
    if (!/^1\d{10}$/.test(mobile) || !verifyCode) throw new AppError("请填写手机号和短信验证码", "AUTH", 400);
    const cloud = await loginByPhone(mobile, verifyCode);
    const session: VendorSession = {
      vendorId: "pantum",
      userId: cloud.userId,
      region: pending.region || "cn",
      devices: new Map(),
      state: { ...cloud, devices: [] } satisfies PantumState,
    };
    await refresh(session);
    return { kind: "ok", session };
  },
  async checkSession(session) {
    const state = stateOf(session);
    await listBindDevices(state.token);
  },
  listDevices: refresh,
  async refreshLive(session) {
    const devices = await refresh(session);
    return Object.fromEntries(devices.map((device) => [device.did, device.live || []]));
  },
  async getDeviceDetail(session, did): Promise<DeviceDetail> {
    const device = findDevice(session, did);
    return {
      device: summary(device),
      services: [
        {
          siid: 2,
          name: "打印",
          properties: [
            {
              siid: 2,
              piid: 1,
              name: "序列号",
              format: "string",
              writable: false,
              range: null,
              list: [],
              value: device.sn,
            },
          ],
          actions: [{ siid: 2, aiid: 1, name: "上传打印" }],
        },
      ],
    };
  },
  async setProperty() {
    throw new AppError("云端设备不可修改", "PROP", 400);
  },
  async runAction() {
    throw new AppError("请上传文件打印", "ACTION", 400);
  },
};
