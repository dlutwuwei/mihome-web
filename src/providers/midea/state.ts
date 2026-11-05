import { deviceId } from "./crypto.js";

export const REGIONS: Record<string, { name: string; host: string }> = {
  cn: { name: "中国", host: "https://mp-prod.smartmidea.net" },
};

export interface MideaAuthState {
  region: string;
  deviceId: string;
  accessToken: string;
  userId: string;
  sessionKey: Buffer | null;
  randomToken: string;
  captchaBody: Buffer | null;
  captchaType: string;
  /** 最近一次读到的原始状态，写回时用来还原字段形态 */
  raw: Map<string, Record<string, unknown>>;
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
    raw: new Map(),
  };
}

export function hostOf(region: string) {
  return (REGIONS[region] || REGIONS.cn).host;
}

export function asMidea(state: unknown) {
  const row = state as MideaAuthState & { fields?: Map<string, Record<string, unknown>> };
  if (!(row.raw instanceof Map)) row.raw = row.fields instanceof Map ? row.fields : new Map();
  return row;
}
