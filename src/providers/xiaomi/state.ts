import { CookieJar } from "./http.js";

export const REGIONS: Record<string, string> = {
  cn: "中国",
  de: "欧洲",
  us: "美国",
  ru: "俄罗斯",
  sg: "新加坡",
  tw: "台湾",
  i2: "印度",
};

export interface XiaomiAuthState {
  jar: CookieJar;
  ua: string;
  region: string;
  userId: string;
  cUserId: string;
  ssecurity: string;
  serviceToken: string;
  username?: string;
  password?: string;
  captchaUrl?: string;
  notificationUrl?: string;
  emailContext?: string;
  lp?: string;
  qr?: string;
  loginUrl?: string;
}

function agent() {
  const id = Array.from({ length: 13 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 5))).join("");
  const text = Array.from({ length: 18 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("");
  return `${text}-${id} APP/com.xiaomi.mihome APPV/10.5.201`;
}

function deviceId() {
  return Array.from({ length: 6 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("");
}

export function createAuthState(region: string): XiaomiAuthState {
  const jar = new CookieJar();
  jar.set("sdkVersion", "accountsdk-18.8.15");
  jar.set("deviceId", deviceId());
  return {
    jar,
    ua: agent(),
    region: REGIONS[region] ? region : "cn",
    userId: "",
    cUserId: "",
    ssecurity: "",
    serviceToken: "",
  };
}

export function regionHost(region: string) {
  const code = REGIONS[region] ? region : "cn";
  const prefix = code === "cn" ? "" : `${code}.`;
  return `https://${prefix}api.io.mi.com/app`;
}

export function asXiaomi(state: unknown): XiaomiAuthState {
  return state as XiaomiAuthState;
}
