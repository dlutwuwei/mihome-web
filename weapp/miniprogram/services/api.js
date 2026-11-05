const DEFAULT_BASE_URL = "http://127.0.0.1:8787";
const STORAGE_BASE_URL = "mihome.weapp.baseUrl";
const STORAGE_API_KEY = "mihome.weapp.apiKey";

let config = {
  baseUrl: DEFAULT_BASE_URL,
  apiKey: "",
};

function normalizeBaseUrl(value) {
  const normalized = String(value || "").trim().replace(/\/+$/, "");
  return normalized.endsWith("/api/open") ? normalized.slice(0, -9) : normalized;
}

function configure(next) {
  config = {
    baseUrl: normalizeBaseUrl(next.baseUrl) || DEFAULT_BASE_URL,
    apiKey: String(next.apiKey || "").trim(),
  };
}

function restoreConfig() {
  const baseUrl = wx.getStorageSync(STORAGE_BASE_URL) || DEFAULT_BASE_URL;
  const apiKey = wx.getStorageSync(STORAGE_API_KEY) || "";
  configure({ baseUrl, apiKey });
  return { baseUrl: normalizeBaseUrl(baseUrl) || DEFAULT_BASE_URL, apiKey };
}

function saveConfig(baseUrl, apiKey) {
  const next = { baseUrl: normalizeBaseUrl(baseUrl), apiKey: String(apiKey || "").trim() };
  wx.setStorageSync(STORAGE_BASE_URL, next.baseUrl);
  wx.setStorageSync(STORAGE_API_KEY, next.apiKey);
  configure(next);
  return next;
}

function clearConfig() {
  wx.removeStorageSync(STORAGE_BASE_URL);
  wx.removeStorageSync(STORAGE_API_KEY);
  configure({ baseUrl: DEFAULT_BASE_URL, apiKey: "" });
}

function request(path, options = {}) {
  if (!config.apiKey) return Promise.reject(new Error("请先填写 API Key"));
  return new Promise((resolve, reject) => {
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
        const body = response.data || {};
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(body);
          return;
        }
        const error = new Error(body.error || `服务请求失败（${response.statusCode}）`);
        error.statusCode = response.statusCode;
        reject(error);
      },
      fail(result) {
        reject(new Error(result.errMsg || "无法连接服务，请检查地址和网络"));
      },
    });
  });
}

function devicePath(accountId, did, suffix = "") {
  return `/devices/${encodeURIComponent(accountId)}/${encodeURIComponent(did)}${suffix}`;
}

module.exports = {
  DEFAULT_BASE_URL,
  normalizeBaseUrl,
  configure,
  restoreConfig,
  saveConfig,
  clearConfig,
  getInfo: () => request("/info"),
  listDevices: () => request("/devices"),
  getLive: () => request("/live"),
  getDeviceDetail: (accountId, did) => request(devicePath(accountId, did)),
  setProperty: (accountId, did, property, value) => request(devicePath(accountId, did, "/props"), {
    method: "POST",
    data: {
      siid: property.siid,
      piid: property.piid,
      id: property.id || undefined,
      value,
    },
  }),
  runAction: (accountId, did, action) => request(devicePath(accountId, did, "/actions"), {
    method: "POST",
    data: { siid: action.siid, aiid: action.aiid },
  }),
};
