const { observable, action, runInAction } = require("mobx-miniprogram");
const api = require("../services/api");
const {
  decorateDevice,
  decorateServices,
  findProperty,
  findAction,
  updatePropertyView,
  clampPropertyValue,
} = require("../utils/device");

const restored = api.restoreConfig();
let devicesGeneration = 0;
let detailGeneration = 0;

const deviceStore = observable({
  baseUrl: restored.baseUrl,
  apiKey: restored.apiKey,
  info: null,
  devices: [],
  selectedRoom: "全部",
  loading: false,
  connecting: false,
  error: "",
  warning: "",
  detail: null,
  services: [],
  featuredKey: "",
  detailLoading: false,
  detailError: "",
  busyKey: "",
  actionBusyKey: "",

  get configured() {
    return Boolean(this.baseUrl && this.apiKey);
  },

  get scopes() {
    return (this.info && this.info.scopes) || [];
  },

  get canControl() {
    return this.scopes.includes("devices:control");
  },

  get canReadLive() {
    return this.scopes.includes("devices:live");
  },

  get onlineCount() {
    return this.devices.filter((device) => device.online).length;
  },

  get accountCount() {
    return this.info && this.info.accounts ? this.info.accounts.length : 0;
  },

  get rooms() {
    const counts = new Map();
    this.devices.forEach((device) => {
      const room = device.room || "未分组";
      counts.set(room, (counts.get(room) || 0) + 1);
    });
    return [
      { name: "全部", count: this.devices.length },
      ...Array.from(counts.entries()).map(([name, count]) => ({ name, count })),
    ];
  },

  get filteredDevices() {
    if (this.selectedRoom === "全部") return this.devices;
    return this.devices.filter((device) => (device.room || "未分组") === this.selectedRoom);
  },

  get featuredProperty() {
    return this.featuredKey ? findProperty(this.services, this.featuredKey) : null;
  },

  updateBaseUrl: action(function (value) {
    this.baseUrl = value;
  }),

  updateApiKey: action(function (value) {
    this.apiKey = value;
  }),

  setRoom: action(function (room) {
    this.selectedRoom = room;
  }),

  clearError: action(function () {
    this.error = "";
    this.detailError = "";
  }),

  loadDevices: action(async function () {
    if (!this.configured) {
      devicesGeneration += 1;
      this.devices = [];
      this.info = null;
      this.loading = false;
      return;
    }
    const generation = ++devicesGeneration;
    this.loading = true;
    this.error = "";
    this.warning = "";
    api.configure({ baseUrl: this.baseUrl, apiKey: this.apiKey });
    try {
      const [info, result] = await Promise.all([api.getInfo(), api.listDevices()]);
      let liveMap = {};
      let warning = (result.warnings || []).join("；");
      if ((info.scopes || []).includes("devices:live")) {
        try {
          const liveResult = await api.getLive();
          liveMap = liveResult.live || {};
        } catch {
          warning = warning || "实时状态暂不可用，设备控制不受影响";
        }
      }
      runInAction(() => {
        if (generation !== devicesGeneration) return;
        this.info = info;
        this.devices = (result.devices || []).map((device, index) => decorateDevice(device, index, liveMap));
        if (this.selectedRoom !== "全部" && !this.rooms.some((room) => room.name === this.selectedRoom)) {
          this.selectedRoom = "全部";
        }
        this.warning = warning;
      });
    } catch (error) {
      runInAction(() => {
        if (generation === devicesGeneration) this.error = error.message || "设备加载失败";
      });
      throw error;
    } finally {
      runInAction(() => {
        if (generation === devicesGeneration) this.loading = false;
      });
    }
  }),

  saveConnection: action(async function () {
    const baseUrl = api.normalizeBaseUrl(this.baseUrl);
    const apiKey = String(this.apiKey || "").trim();
    if (!/^https?:\/\//.test(baseUrl)) throw new Error("服务地址需以 http:// 或 https:// 开头");
    if (!apiKey) throw new Error("请填写 API Key");
    this.connecting = true;
    this.error = "";
    runInAction(() => {
      this.baseUrl = baseUrl;
      this.apiKey = apiKey;
      this.info = null;
    });
    api.saveConfig(baseUrl, apiKey);
    try {
      await this.loadDevices();
      return this.info;
    } finally {
      runInAction(() => {
        this.connecting = false;
      });
    }
  }),

  clearConnection: action(function () {
    devicesGeneration += 1;
    detailGeneration += 1;
    api.clearConfig();
    this.baseUrl = api.DEFAULT_BASE_URL;
    this.apiKey = "";
    this.info = null;
    this.devices = [];
    this.detail = null;
    this.services = [];
    this.featuredKey = "";
    this.error = "";
    this.warning = "";
    this.detailError = "";
    this.loading = false;
    this.detailLoading = false;
    this.busyKey = "";
    this.actionBusyKey = "";
  }),

  loadDeviceDetail: action(async function (accountId, did) {
    if (!this.configured) throw new Error("请先完成服务接入");
    const generation = ++detailGeneration;
    this.detailLoading = true;
    this.detailError = "";
    this.detail = null;
    this.services = [];
    this.featuredKey = "";
    try {
      const detail = await api.getDeviceDetail(accountId, did);
      const decorated = decorateServices(detail.services || []);
      runInAction(() => {
        if (generation !== detailGeneration) return;
        this.detail = { ...detail, device: decorateDevice(detail.device, 0) };
        this.services = decorated.services;
        this.featuredKey = decorated.featuredKey;
      });
    } catch (error) {
      runInAction(() => {
        if (generation === detailGeneration) this.detailError = error.message || "设备详情加载失败";
      });
      throw error;
    } finally {
      runInAction(() => {
        if (generation === detailGeneration) this.detailLoading = false;
      });
    }
  }),

  previewProperty: action(function (key, value) {
    const property = findProperty(this.services, key);
    if (!property) return;
    property.value = property.hasRange ? clampPropertyValue(property, value) : value;
    updatePropertyView(property);
  }),

  writeProperty: action(async function (key, value) {
    if (!this.canControl) throw new Error("当前 API Key 没有 devices:control 权限");
    if (this.busyKey) return;
    const property = findProperty(this.services, key);
    if (!property || !property.writable || !this.detail) return;
    const nextValue = property.hasRange ? clampPropertyValue(property, value) : value;
    if (property.value === nextValue) return;
    const previous = property.value;
    const accountId = this.detail.device.accountId;
    const did = this.detail.device.did;
    this.busyKey = key;
    this.detailError = "";
    this.previewProperty(key, nextValue);
    try {
      await api.setProperty(accountId, did, property, property.value);
    } catch (error) {
      runInAction(() => {
        this.previewProperty(key, previous);
        this.detailError = error.message || "属性写入失败";
      });
      throw error;
    } finally {
      runInAction(() => {
        this.busyKey = "";
      });
    }
  }),

  stepFeatured: action(async function (direction) {
    const property = this.featuredProperty;
    if (!property || this.busyKey) return;
    const next = Number(property.value || 0) + direction * property.rangeStep;
    await this.writeProperty(property.key, clampPropertyValue(property, next));
  }),

  runDeviceAction: action(async function (key) {
    if (!this.canControl) throw new Error("当前 API Key 没有 devices:control 权限");
    if (this.actionBusyKey || !this.detail) return;
    const found = findAction(this.services, key);
    if (!found) return;
    this.actionBusyKey = key;
    this.detailError = "";
    try {
      await api.runAction(this.detail.device.accountId, this.detail.device.did, found.action);
    } catch (error) {
      runInAction(() => {
        this.detailError = error.message || "动作执行失败";
      });
      throw error;
    } finally {
      runInAction(() => {
        this.actionBusyKey = "";
      });
    }
  }),
});

module.exports = { deviceStore };
