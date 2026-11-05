import { observable, action, runInAction } from "mobx-miniprogram";
import * as api from "../services/api";
import {
  decorateDevice,
  decorateServices,
  findProperty,
  findAction,
  updatePropertyView,
  clampPropertyValue,
  apparentTemperatureOf,
  comfortOf,
} from "../utils/device";
import type { ApiInfo, Device, DeviceStore, LiveMap, RoomSummary } from "../types";

function roomOf(device: Pick<Device, "room"> | null | undefined): string {
  const room = String((device && device.room) || "").replace(/\s+/g, " ").trim();
  return room || "未分组";
}

// 顶部家庭卡片的温度色阶：越冷越蓝，越热越红。
const TEMPERATURE_TONES: Array<{ below: number; className: string }> = [
  { below: 12, className: "hero-temp-cold" },
  { below: 20, className: "hero-temp-cool" },
  { below: 26, className: "hero-temp-mild" },
  { below: 30, className: "hero-temp-warm" },
];

export function temperatureTone(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  for (let i = 0; i < TEMPERATURE_TONES.length; i += 1) {
    if (value < TEMPERATURE_TONES[i].below) return TEMPERATURE_TONES[i].className;
  }
  return "hero-temp-hot";
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  const text = String(error || "");
  return text || fallback;
}

const restored = api.restoreConfig();
let devicesGeneration = 0;
let detailGeneration = 0;

const storeDefinition: DeviceStore & ThisType<DeviceStore> = {
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
  confirmed: {},
  featuredRevision: 0,

  get configured(): boolean {
    return Boolean(this.baseUrl && this.apiKey);
  },

  get scopes(): string[] {
    return (this.info && this.info.scopes) || [];
  },

  get canControl(): boolean {
    return this.scopes.includes("devices:control");
  },

  get canReadLive(): boolean {
    return this.scopes.includes("devices:live");
  },

  get onlineCount(): number {
    const devices = this.devices;
    let count = 0;
    for (let i = 0; i < devices.length; i += 1) {
      if (devices[i].online) count += 1;
    }
    return count;
  },

  get accountCount(): number {
    return this.info && this.info.accounts ? this.info.accounts.length : 0;
  },

  get rooms(): RoomSummary[] {
    const counts = new Map<string, number>();
    const devices = this.devices;
    for (let i = 0; i < devices.length; i += 1) {
      const room = roomOf(devices[i]);
      counts.set(room, (counts.get(room) || 0) + 1);
    }
    const summaries: RoomSummary[] = [{ name: "全部", count: devices.length }];
    counts.forEach((count, name) => {
      summaries.push({ name, count });
    });
    return summaries;
  },

  get selectedRoomIndex(): number {
    const selected = this.selectedRoom;
    const rooms = this.rooms;
    for (let i = 0; i < rooms.length; i += 1) {
      if (rooms[i].name === selected) return i;
    }
    return 0;
  },

  get selectedRoomScrollId(): string {
    return `room-${this.selectedRoomIndex}`;
  },

  get filteredDevices(): Device[] {
    const selected = this.selectedRoom;
    const devices = this.devices;
    if (selected === "全部") return devices;
    // 小程序会把箭头函数降级成普通函数：回调里的 this 不再是 store。
    // 房间名先取到局部变量，用普通循环筛选，避免 computed 依赖 this 丢失。
    const result: Device[] = [];
    for (let i = 0; i < devices.length; i += 1) {
      if (roomOf(devices[i]) === selected) result.push(devices[i]);
    }
    return result;
  },

  get averageTemperature(): number | null {
    const readings: number[] = [];
    const devices = this.devices;
    for (let i = 0; i < devices.length; i += 1) {
      const value = devices[i].temperature;
      if (typeof value === "number" && Number.isFinite(value)) readings.push(value);
    }
    if (!readings.length) return null;
    const total = readings.reduce((sum, value) => sum + value, 0);
    return Math.round((total / readings.length) * 10) / 10;
  },

  get averageTemperatureText(): string {
    const value = this.averageTemperature;
    return value === null ? "--" : `${value}°C`;
  },

  get averageHumidity(): number | null {
    const readings: number[] = [];
    const devices = this.devices;
    for (let i = 0; i < devices.length; i += 1) {
      const value = devices[i].humidity;
      if (typeof value === "number" && Number.isFinite(value)) readings.push(value);
    }
    if (!readings.length) return null;
    const total = readings.reduce((sum, value) => sum + value, 0);
    return Math.round(total / readings.length);
  },

  get averageHumidityText(): string {
    const value = this.averageHumidity;
    return value === null ? "" : `${value}%`;
  },

  get apparentTemperature(): number | null {
    return apparentTemperatureOf(this.averageTemperature, this.averageHumidity);
  },

  get comfortText(): string {
    return comfortOf(this.averageTemperature, this.averageHumidity);
  },

  get heroTone(): string {
    if (!this.configured) return "";
    return temperatureTone(this.averageTemperature);
  },

  get featuredProperty() {
    // 绑定只跟踪 getter 里读到的 observable：拖动预览改的是属性值本身，
    // 这里读一下 revision 并返回新对象，reaction 才会重绘总览表盘。
    void this.featuredRevision;
    const property = this.featuredKey ? findProperty(this.services, this.featuredKey) : null;
    return property ? { ...property } : null;
  },

  updateBaseUrl: action(function (this: DeviceStore, value: string): void {
    this.baseUrl = value;
  }),

  updateApiKey: action(function (this: DeviceStore, value: string): void {
    this.apiKey = value;
  }),

  setRoom: action(function (this: DeviceStore, room: string): void {
    const name = String(room || "").replace(/\s+/g, " ").trim();
    this.selectedRoom = name || "全部";
  }),

  clearError: action(function (this: DeviceStore): void {
    this.error = "";
    this.detailError = "";
  }),

  loadDevices: action(async function (this: DeviceStore): Promise<void> {
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
      let liveMap: LiveMap = {};
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
        const selected = this.selectedRoom;
        if (selected !== "全部") {
          const rooms = this.rooms;
          let present = false;
          for (let i = 0; i < rooms.length; i += 1) {
            if (rooms[i].name === selected) {
              present = true;
              break;
            }
          }
          if (!present) this.selectedRoom = "全部";
        }
        this.warning = warning;
      });
    } catch (error) {
      runInAction(() => {
        if (generation === devicesGeneration) this.error = errorMessage(error, "设备加载失败");
      });
      throw error;
    } finally {
      runInAction(() => {
        if (generation === devicesGeneration) this.loading = false;
      });
    }
  }),

  saveConnection: action(async function (this: DeviceStore): Promise<ApiInfo | null> {
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

  clearConnection: action(function (this: DeviceStore): void {
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
    this.confirmed = {};
    this.featuredRevision += 1;
  }),

  loadDeviceDetail: action(async function (this: DeviceStore, accountId: string, did: string): Promise<void> {
    if (!this.configured) throw new Error("请先完成服务接入");
    const generation = ++detailGeneration;
    this.detailLoading = true;
    this.detailError = "";
    this.detail = null;
    this.services = [];
    this.featuredKey = "";
    this.confirmed = {};
    try {
      const detail = await api.getDeviceDetail(accountId, did);
      const decorated = decorateServices(detail.services || []);
      const confirmed: Record<string, unknown> = {};
      for (const service of decorated.services) {
        for (const property of service.properties) confirmed[property.key] = property.value;
      }
      runInAction(() => {
        if (generation !== detailGeneration) return;
        this.detail = { ...detail, device: decorateDevice(detail.device, 0) };
        this.services = decorated.services;
        this.featuredKey = decorated.featuredKey;
        this.confirmed = confirmed;
        this.featuredRevision += 1;
      });
    } catch (error) {
      runInAction(() => {
        if (generation === detailGeneration) this.detailError = errorMessage(error, "设备详情加载失败");
      });
      throw error;
    } finally {
      runInAction(() => {
        if (generation === detailGeneration) this.detailLoading = false;
      });
    }
  }),

  previewProperty: action(function (this: DeviceStore, key: string, value: unknown): void {
    const property = findProperty(this.services, key);
    if (!property) return;
    property.value = property.hasRange ? clampPropertyValue(property, value) : value;
    updatePropertyView(property);
    // services 是深层 observable，但 createStoreBindings 只盯数组引用，
    // 嵌套属性的变化不会触发 setData；总览表盘靠 revision 单独刷新。
    if (key === this.featuredKey) this.featuredRevision += 1;
  }),

  writeProperty: action(async function (this: DeviceStore, key: string, value: unknown): Promise<void> {
    if (!this.canControl) throw new Error("当前 API Key 没有 devices:control 权限");
    if (this.busyKey) return;
    const property = findProperty(this.services, key);
    if (!property || !property.writable || !this.detail) return;
    const nextValue = property.hasRange ? clampPropertyValue(property, value) : value;
    // property.value 可能已被拖动预览改过，不能拿它判断“值没变”，
    // 否则滑块/表盘松手后永远跳过写入。
    const known = Object.prototype.hasOwnProperty.call(this.confirmed, key) ? this.confirmed[key] : property.value;
    if (known === nextValue) return;
    // 失败时回到设备确认过的值，而不是可能悬在半路的拖动预览值
    const previous = known;
    const accountId = this.detail.device.accountId;
    const did = this.detail.device.did;
    this.busyKey = key;
    this.detailError = "";
    this.previewProperty(key, nextValue);
    // 换成新的数组引用，让绑定把开关/选项/滑块的新值同步到视图
    this.services = this.services.slice();
    try {
      await api.setProperty(accountId, did, property, nextValue);
      runInAction(() => {
        this.confirmed[key] = nextValue;
      });
    } catch (error) {
      runInAction(() => {
        this.previewProperty(key, previous);
        this.services = this.services.slice();
        this.detailError = errorMessage(error, "属性写入失败");
      });
      throw error;
    } finally {
      runInAction(() => {
        this.busyKey = "";
      });
    }
  }),

  stepFeatured: action(async function (this: DeviceStore, direction: number): Promise<void> {
    const property = this.featuredProperty;
    if (!property || this.busyKey) return;
    const next = Number(property.value || 0) + direction * property.rangeStep;
    await this.writeProperty(property.key, clampPropertyValue(property, next));
  }),

  runDeviceAction: action(async function (this: DeviceStore, key: string): Promise<void> {
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
        this.detailError = errorMessage(error, "动作执行失败");
      });
      throw error;
    } finally {
      runInAction(() => {
        this.actionBusyKey = "";
      });
    }
  }),
};

export const deviceStore = observable(storeDefinition);
