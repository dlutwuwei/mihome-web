import type { PendingAuth, VendorProvider } from "../types.js";
import * as auth from "./auth.js";
import * as devices from "./devices.js";
import { REGIONS } from "./state.js";

export const xiaomiProvider: VendorProvider = {
  id: "xiaomi",
  name: "小米 / 米家",
  authModes: ["password", "qr"],
  listRegions() {
    return Object.entries(REGIONS).map(([id, name]) => ({ id, name }));
  },
  createPending(region: string): PendingAuth {
    return auth.createXiaomiPending(region);
  },
  loginPassword: auth.loginPassword,
  beginEmail2fa: auth.beginEmail2fa,
  verifyEmail2fa: auth.verifyEmail2fa,
  beginQr: auth.beginQr,
  pollQr: auth.pollQr,
  getCaptchaImage: auth.getCaptchaImage,
  getQrImage: auth.getQrImage,
  listDevices: devices.listDevices,
  refreshLive: devices.refreshLive,
  getDeviceDetail: devices.getDeviceDetail,
  setProperty: devices.setProperty,
  runAction: devices.runAction,
};
