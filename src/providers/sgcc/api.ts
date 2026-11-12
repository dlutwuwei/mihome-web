import { AppError } from "../../core/errors.js";
import type { DataTable } from "../../controls/types.js";
import { PATHS, SgClient, SgError, createDeviceState } from "./protocol.mjs";

export const HOSTS: Record<string, string> = {
  default: "https://csc-service.sgcc.com.cn:28630",
};

const CACHE_MS = 10 * 60 * 1000;

export interface Meter {
  consNo: string;
  src: string;
  name: string;
  addr: string;
  orgNo: string;
  proCode: string;
  elec: string;
}

export interface UsageRow {
  key: string;
  pq: string;
  amt: string;
}

export interface UsageSnapshot {
  at: number;
  monthPq: number | null;
  monthAmt: number | null;
  balance: number | null;
  owe: number | null;
  addr: string;
  days: UsageRow[];
  months: UsageRow[];
}

export interface SgccState {
  host: string;
  token: string;
  userId: string;
  mobile: string;
  password: string;
  deviceState: ReturnType<typeof createDeviceState>;
  province: string;
  meters: Meter[];
  usage: Record<string, UsageSnapshot>;
  exp: number;
}

export function newDeviceState() {
  return createDeviceState();
}

export function hostOf(region: string) {
  return HOSTS[region] || HOSTS.default;
}

function text(value: unknown) {
  return value == null ? "" : String(value).trim();
}

function asNumber(value: unknown) {
  if (value == null || value === "") return null;
  const n = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function qty(value: number | null) {
  if (value == null) return "";
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function isSgError(error: unknown): error is SgError {
  return error instanceof SgError || (typeof error === "object" && !!error && (error as { name?: string }).name === "SgError");
}

function isNewDevice(error: unknown) {
  if (!isSgError(error)) return false;
  const code = String(error.code || "");
  const message = String(error.message || "");
  return code === "4006" || /新设备/.test(message);
}

function mapError(error: unknown): never {
  if (error instanceof AppError) throw error;
  if (isSgError(error)) {
    const code = String(error.code || "");
    const message = String(error.message || "");
    const auth = ["auth", "0100", "-200", "-201", "4006", "RK007", "RK008", "RK1003"].includes(code)
      || /账号|密码|登录|登陆|过期|失效|验证码|新设备|安全验证/i.test(message);
    throw new AppError(message || "国网接口失败", auth ? "AUTH" : "SGCC", auth ? 401 : 502);
  }
  const message = error instanceof Error ? error.message : "国网请求失败";
  throw new AppError(message, "SGCC", 502);
}

function clientOf(state: Pick<SgccState, "mobile" | "password" | "deviceState" | "token" | "userId" | "province" | "exp" | "meters">) {
  const client = new SgClient({
    username: state.mobile,
    password: state.password,
    deviceState: state.deviceState,
  });
  if (state.token) {
    client.sess = {
      user: state.mobile,
      token: state.token,
      userId: state.userId || "0",
      province: state.province || "",
      exp: state.exp || Date.now() + 3600_000,
      accounts: state.meters.map((meter) => ({
        consNo: meter.consNo,
        src: meter.src,
        pro: meter.proCode,
        org: meter.orgNo,
        elec: meter.elec,
        name: meter.name,
        addr: meter.addr,
      })),
    };
  }
  return client;
}

function syncClient(state: SgccState, client: SgClient) {
  state.deviceState = client.deviceState;
  if (client.sess) {
    state.token = client.sess.token;
    state.userId = client.sess.userId;
    state.province = client.sess.province || "";
    state.exp = client.sess.exp;
    state.meters = (client.sess.accounts || []).map((account: {
      consNo: string;
      src?: string;
      name?: string;
      addr?: string;
      org?: string;
      pro?: string;
      elec?: string;
    }) => ({
      consNo: account.consNo,
      src: account.src || account.consNo,
      name: "智能电表",
      addr: account.addr || "",
      orgNo: account.org || "",
      proCode: account.pro || "",
      elec: account.elec || "",
    }));
  }
}

export async function loginByPassword(mobile: string, password: string, deviceState = createDeviceState(), code = "", codeKey = "") {
  const client = new SgClient({ username: mobile, password, deviceState });
  try {
    await client.login(code, codeKey);
  } catch (error) {
    if (isNewDevice(error)) {
      throw new AppError(String((error as SgError).message || "请进行安全验证"), "DEVICE", 401, { deviceState: client.deviceState });
    }
    mapError(error);
  }
  const state: SgccState = {
    host: HOSTS.default,
    token: "",
    userId: "",
    mobile: client.user,
    password,
    deviceState: client.deviceState,
    province: "",
    meters: [],
    usage: {},
    exp: 0,
  };
  syncClient(state, client);
  if (!state.token) throw new AppError("登录成功但没有返回 token", "AUTH", 401);
  return state;
}

export async function sendDeviceCode(mobile: string, password: string, deviceState = createDeviceState()) {
  const client = new SgClient({ username: mobile, password, deviceState });
  try {
    const codeKey = await client.sendDeviceSms();
    return { codeKey, deviceState: client.deviceState };
  } catch (error) {
    mapError(error);
  }
}

export async function loadMeters(state: SgccState) {
  if (state.meters.length) return state.meters;
  const client = clientOf(state);
  try {
    await client.login();
  } catch (error) {
    mapError(error);
  }
  syncClient(state, client);
  return state.meters;
}

function consType(meter: Meter) {
  return meter.elec === "04" || (meter.elec === "02" && meter.proCode === "11102") ? "02" : "01";
}

function monthKey(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 6) return "";
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}`;
}

function dayKey(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 8) return "";
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function ymd(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function monthRange(year: number, month: number) {
  const end = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return [ymd(year, month, 1), ymd(year, month, end)] as const;
}

function chinaNow() {
  const d = new Date(Date.now() + 8 * 3600_000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
}

async function fetchUsage(state: SgccState, meter: Meter): Promise<UsageSnapshot> {
  const client = clientOf(state);
  const now = chinaNow();
  const days = new Map<string, UsageRow>();
  const months = new Map<string, UsageRow>();
  let monthPq: number | null = null;
  let monthAmt: number | null = null;
  let balance: number | null = null;
  let owe: number | null = null;
  let addr = meter.addr;

  for (let off = 0; off < 2; off++) {
    let y = now.y;
    let m = now.m - off;
    if (m < 1) {
      m += 12;
      y -= 1;
    }
    const [start, end] = monthRange(y, m);
    try {
      const data = await client.authed(PATHS.DAILY, {
        serviceCode: "BCP_000026",
        source: "app",
        target: meter.proCode,
        data: {
          acctId: "acctid01",
          channelCode: "SGAPP",
          consNo: meter.src,
          consNosrc: meter.src,
          endTime: end,
          consType: consType(meter),
          funcCode: "ALIPAY_01",
          orgNo: meter.orgNo,
          proCode: meter.proCode,
          promotCode: "1",
          promotType: "1",
          serialNo: "",
          srvCode: "",
          startTime: start,
          userName: "acctid01",
        },
      });
      syncClient(state, client);
      const list = Array.isArray((data as { sevenEleList?: unknown }).sevenEleList)
        ? (data as { sevenEleList: Record<string, unknown>[] }).sevenEleList
        : [];
      for (const row of list) {
        const key = dayKey(text(row.day));
        if (!key) continue;
        const pq = asNumber(row.dayElePq ?? row.totalPq ?? row.pq);
        days.set(key, { key, pq: qty(pq), amt: "" });
      }
      if (off === 0) monthPq = asNumber((data as { totalPq?: unknown }).totalPq);
    } catch (error) {
      if (off === 0 && !days.size) mapError(error);
    }
  }

  for (const year of [now.y, now.y - 1]) {
    try {
      const data = await client.authed(PATHS.MONTH, {
        serviceCode: "BCP_000026",
        source: "app",
        target: meter.proCode,
        data: {
          year,
          consNo: meter.src,
          provinceCode: meter.proCode,
          startYm: `${year}01`,
          endYm: `${year}12`,
          funcCode: "ALIPAY_01",
        },
      });
      syncClient(state, client);
      const raw = Array.isArray((data as { list?: unknown }).list)
        ? (data as { list: Record<string, unknown>[] }).list
        : Array.isArray((data as { mothEleList?: unknown }).mothEleList)
          ? (data as { mothEleList: Record<string, unknown>[] }).mothEleList
          : Array.isArray((data as { monthEleList?: unknown }).monthEleList)
            ? (data as { monthEleList: Record<string, unknown>[] }).monthEleList
            : [];
      for (const row of raw) {
        const key = monthKey(text(row.ym || row.month));
        if (!key) continue;
        const ele = Array.isArray(row.eleList) ? row.eleList as Record<string, unknown>[] : [];
        let pq = asNumber(row.monthPq ?? row.monthEleNum ?? row.pq ?? row.totalPq);
        if (pq == null && ele.length) pq = ele.reduce((sum, item) => sum + (asNumber(item.pq) || 0), 0);
        let amt = asNumber(row.monthAmt ?? row.monthEleCost ?? row.amt);
        if (amt == null && ele.length) amt = ele.reduce((sum, item) => sum + (asNumber(item.amt) || 0), 0);
        months.set(key, { key, pq: qty(pq), amt: qty(amt) });
        if (key.replace("-", "") === `${now.y}${String(now.m).padStart(2, "0")}`) {
          if (pq != null) monthPq = pq;
          if (amt != null) monthAmt = amt;
        }
      }
      if (year === now.y && months.size) break;
    } catch (error) {
      if (isSgError(error) && ["-200", "-201", "4006", "RK008"].includes(String(error.code || ""))) mapError(error);
      break;
    }
  }

  try {
    const data = await client.authed(PATHS.BAL, {
      serviceCode: "0101143",
      source: "app",
      target: meter.proCode,
      data: {
        srvCode: "",
        serialNo: "",
        channelCode: "0902",
        funcCode: "A1007200",
        acctId: state.userId,
        userName: "acctid01",
        promotType: "1",
        promotCode: "1",
        userAccountId: state.userId,
        list: [{
          consNoSrc: meter.src,
          proCode: meter.proCode,
          sceneType: meter.elec,
          consNo: meter.consNo,
          orgNo: meter.orgNo,
        }],
      },
    });
    syncClient(state, client);
    const bal = (Array.isArray((data as { list?: unknown }).list)
      ? (data as { list: Record<string, unknown>[] }).list
      : []).find((row) => row && typeof row === "object");
    if (bal) {
      addr = text(bal.elecAddr) || addr;
      const sm = asNumber(bal.sumMoney);
      const ab = asNumber(bal.accountBalance);
      const pb = asNumber(bal.prepayBal);
      const ho = asNumber(bal.historyOwe);
      if (text(bal.consType) === "1") {
        balance = sm ?? pb;
        if (balance != null && balance < 0) owe = Math.abs(balance);
      } else {
        const validAb = ab != null && ab > 0 ? ab : 0;
        const validSm = sm != null && sm > 0 ? sm : 0;
        balance = validAb > 0 ? validAb - validSm : validSm;
        if (ho != null && ho > 0) {
          owe = ho;
          balance = -ho;
        }
      }
      if (ho != null && ho > 0) owe = Math.max(owe || 0, ho);
    }
  } catch (error) {
    if (isSgError(error) && ["-200", "-201", "4006", "RK008"].includes(String(error.code || ""))) mapError(error);
  }

  const current = `${now.y}-${String(now.m).padStart(2, "0")}`;
  let dayRows = [...days.values()].filter((row) => row.pq || row.amt).sort((a, b) => b.key.localeCompare(a.key));
  if (dayRows.some((row) => row.key.startsWith(current))) dayRows = dayRows.filter((row) => row.key.startsWith(current));
  const monthRows = [...months.values()].filter((row) => row.pq || row.amt).sort((a, b) => b.key.localeCompare(a.key));
  if (monthPq == null) {
    const hit = monthRows.find((row) => row.key === current && row.pq);
    if (hit) monthPq = asNumber(hit.pq);
  }
  if (monthAmt == null) {
    const hit = monthRows.find((row) => row.key === current && row.amt);
    if (hit) monthAmt = asNumber(hit.amt);
  }
  return { at: Date.now(), monthPq, monthAmt, balance, owe, addr, days: dayRows, months: monthRows };
}

export async function loadUsage(state: SgccState, meter: Meter, force = false) {
  const cached = state.usage[meter.consNo];
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached;
  try {
    const snapshot = await fetchUsage(state, meter);
    state.usage[meter.consNo] = snapshot;
    return snapshot;
  } catch (error) {
    mapError(error);
  }
}

export function usageTable(rows: UsageRow[], label: string): DataTable {
  return {
    columns: [
      { key: "key", name: label },
      { key: "pq", name: "用电量(kWh)" },
      { key: "amt", name: "金额(元)" },
    ],
    rows: rows.map((row) => ({ key: row.key, pq: row.pq || "—", amt: row.amt || "—" })),
  };
}

export function formatLive(value: number | null, unit: string) {
  if (value == null) return "—";
  return `${qty(value)} ${unit}`;
}
