import { deviceId } from "./crypto.js";

export const REGIONS: Record<string, { name: string; host: string }> = {
  cn: { name: "中国", host: "https://mp-prod.smartmidea.net" },
};

export interface MideaField {
  key: string;
  boolStyle: "" | "bool" | "onoff" | "zo" | "num";
}

export interface MideaAuthState {
  region: string;
  deviceId: string;
  accessToken: string;
  userId: string;
  sessionKey: Buffer | null;
  randomToken: string;
  captchaBody: Buffer | null;
  captchaType: string;
  fields: Map<string, MideaField[]>;
}

export function createAuthState(region: string, account: string): MideaAuthState {
  const id = REGIONS[region] ? region : "cn";
  return {
    region: id,
    deviceId: deviceId(account),
    accessToken: "",
    userId: "",
    sessionKey: null,
    randomToken: "",
    captchaBody: null,
    captchaType: "",
    fields: new Map(),
  };
}

export function hostOf(region: string) {
  return (REGIONS[region] || REGIONS.cn).host;
}

export function asMidea(state: unknown) {
  return state as MideaAuthState;
}
