import type {
  ActionTarget,
  ApiInfo,
  ConnectionConfig,
  DeviceDetail,
  DevicesResponse,
  LiveResponse,
  SetPropertyTarget,
} from "../types";

export const DEFAULT_BASE_URL = "https://stock-infectious-mid-newark.trycloudflare.com";
const STORAGE_BASE_URL = "mihome.weapp.baseUrl";
const STORAGE_API_KEY = "mihome.weapp.apiKey";

let config: ConnectionConfig = {
  baseUrl: DEFAULT_BASE_URL,
  apiKey: "",
};

export class ApiError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
  }
}

export function normalizeBaseUrl(value: unknown): string {
  const normalized = String(value || "")
    .trim()
    .replace(/\/+$/, "");
  return normalized.endsWith("/api/open") ? normalized.slice(0, -9) : normalized;
}

export function configure(next: ConnectionConfig): void {
  config = {
    baseUrl: normalizeBaseUrl(next.baseUrl) || DEFAULT_BASE_URL,
    apiKey: String(next.apiKey || "").trim(),
  };
}

export function restoreConfig(): ConnectionConfig {
  const baseUrl = String(wx.getStorageSync(STORAGE_BASE_URL) || DEFAULT_BASE_URL);
  const apiKey = String(wx.getStorageSync(STORAGE_API_KEY) || "");
  configure({ baseUrl, apiKey });
  return { baseUrl: normalizeBaseUrl(baseUrl) || DEFAULT_BASE_URL, apiKey };
}

export function saveConfig(baseUrl: string, apiKey: string): ConnectionConfig {
  const next: ConnectionConfig = {
    baseUrl: normalizeBaseUrl(baseUrl),
    apiKey: String(apiKey || "").trim(),
  };
  wx.setStorageSync(STORAGE_BASE_URL, next.baseUrl);
  wx.setStorageSync(STORAGE_API_KEY, next.apiKey);
  configure(next);
  return next;
}

export function clearConfig(): void {
  wx.removeStorageSync(STORAGE_BASE_URL);
  wx.removeStorageSync(STORAGE_API_KEY);
  configure({ baseUrl: DEFAULT_BASE_URL, apiKey: "" });
}

interface RequestOptions {
  method?: "GET" | "POST";
  data?: string | Record<string, unknown> | ArrayBuffer;
}

function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (!config.apiKey) return Promise.reject(new Error("请先填写 API Key"));
  return new Promise<T>((resolve, reject) => {
    wx.request({
      url: `${config.baseUrl}/api/open${path}`,
      method: options.method || "GET",
      data: options.data,
      timeout: 15000,
      header: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      success(response) {
        const body = (response.data || {}) as { error?: string };
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(body as T);
          return;
        }
        reject(new ApiError(body.error || `服务请求失败（${response.statusCode}）`, response.statusCode));
      },
      fail(result) {
        reject(new Error(result.errMsg || "无法连接服务，请检查地址和网络"));
      },
    });
  });
}

function devicePath(accountId: string, did: string, suffix = ""): string {
  return `/devices/${encodeURIComponent(accountId)}/${encodeURIComponent(did)}${suffix}`;
}

export function getInfo(): Promise<ApiInfo> {
  return request<ApiInfo>("/info");
}

export function listDevices(): Promise<DevicesResponse> {
  return request<DevicesResponse>("/devices");
}

export function getLive(): Promise<LiveResponse> {
  return request<LiveResponse>("/live");
}

export function getDeviceDetail(accountId: string, did: string): Promise<DeviceDetail> {
  return request<DeviceDetail>(devicePath(accountId, did));
}

export function setProperty(
  accountId: string,
  did: string,
  property: SetPropertyTarget,
  value: unknown,
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(devicePath(accountId, did, "/props"), {
    method: "POST",
    data: {
      siid: property.siid,
      piid: property.piid,
      id: property.id || undefined,
      value,
    },
  });
}

export function runAction(accountId: string, did: string, action: ActionTarget): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(devicePath(accountId, did, "/actions"), {
    method: "POST",
    data: { siid: action.siid, aiid: action.aiid },
  });
}
