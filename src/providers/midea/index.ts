import type { PendingAuth, VendorProvider } from "../types.js";
import * as auth from "./auth.js";
import * as devices from "./devices.js";
import { REGIONS } from "./state.js";

export const mideaProvider: VendorProvider = {
  id: "midea",
  name: "美的美居",
  authModes: ["sms", "password"],
  listRegions() {
    return Object.entries(REGIONS).map(([id, item]) => ({ id, name: item.name }));
  },
  createPending(region: string): PendingAuth {
    return auth.createMideaPending(region);
  },
  loginPassword: auth.loginPassword,
  loginSms: auth.loginSms,
  sendSms: auth.sendSms,
  getCaptchaImage: auth.getCaptchaImage,
  listDevices: devices.listDevices,
  refreshLive: devices.refreshLive,
  getDeviceDetail: devices.getDeviceDetail,
  setProperty: devices.setProperty,
  runAction: devices.runAction,
};
