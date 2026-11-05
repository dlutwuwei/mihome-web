export interface LiveItem {
  name: string;
  text: string;
}

/** 实时读数缓存：key 为 `${accountId}:${did}`。 */
export type LiveMap = Record<string, LiveItem[]>;

export interface RawDevice {
  did: string;
  accountId?: string;
  vendorId?: string;
  name: string;
  model?: string;
  online: boolean;
  room?: string;
  icon?: string;
  specType?: string;
  live?: LiveItem[];
}

/** 经过视觉与传感器字段装饰后的设备。 */
export interface Device extends RawDevice {
  accountId: string;
  vendorId: string;
  model: string;
  room: string;
  icon: string;
  live: LiveItem[];
  key: string;
  glyph: string;
  accent: number;
  statusText: string;
  primaryLive: string;
  temperature: number | null;
  humidity: number | null;
}

export interface RoomSummary {
  name: string;
  count: number;
}

export type PropertyKind = "slider" | "switch" | "segmented" | "select" | "number" | "text";

export interface Choice {
  value: string | number | boolean;
  name: string;
}

export interface ChoiceView extends Choice {
  key: string;
  selected: boolean;
}

export interface RawProperty {
  id?: string;
  siid: number;
  piid: number;
  name: string;
  kind?: PropertyKind;
  format?: string;
  unit?: string;
  writable?: boolean;
  range?: number[] | null;
  list?: Choice[];
  value?: unknown;
  error?: number;
}

export interface Property {
  id: string;
  siid: number;
  piid: number;
  name: string;
  kind: PropertyKind;
  format?: string;
  unit: string;
  writable: boolean;
  hasRange: boolean;
  rangeMin: number;
  rangeMax: number;
  rangeStep: number;
  list: Choice[];
  value: unknown;
  error?: number;
  key: string;
  featured: boolean;
  displayValue: string;
  options: ChoiceView[];
}

export interface RawAction {
  id?: string;
  siid: number;
  aiid: number;
  name: string;
}

export interface ActionView extends RawAction {
  key: string;
}

export interface RawService {
  siid: number;
  name: string;
  properties?: RawProperty[];
  actions?: RawAction[];
}

export interface Service {
  siid: number;
  name: string;
  key: string;
  properties: Property[];
  actions: ActionView[];
}

export interface DeviceDetail {
  device: RawDevice;
  services: RawService[];
}

export interface DecoratedDetail extends Omit<DeviceDetail, "device"> {
  device: Device;
}

export interface AccountInfo {
  accountId: string;
  vendorId?: string;
  region?: string;
  deviceCount?: number;
}

export interface ApiInfo {
  keyId: string;
  keyName: string;
  scopes: string[];
  accounts: AccountInfo[];
}

export interface DevicesResponse {
  devices: RawDevice[];
  warnings?: string[];
}

export interface LiveResponse {
  live: LiveMap;
}

export interface SetPropertyTarget {
  siid: number;
  piid: number;
  id?: string;
}

export interface ActionTarget {
  siid: number;
  aiid: number;
}

export interface ConnectionConfig {
  baseUrl: string;
  apiKey: string;
}

export interface DeviceStore {
  baseUrl: string;
  apiKey: string;
  info: ApiInfo | null;
  devices: Device[];
  selectedRoom: string;
  loading: boolean;
  connecting: boolean;
  error: string;
  warning: string;
  detail: DecoratedDetail | null;
  services: Service[];
  featuredKey: string;
  detailLoading: boolean;
  detailError: string;
  busyKey: string;
  actionBusyKey: string;
  /** 设备确认过的属性值，用来区分“刚拖动预览的值”和真正的写入 */
  confirmed: Record<string, unknown>;
  /** 拖动总览表盘时递增，让 featuredProperty 绑定跟着刷新 */
  featuredRevision: number;

  readonly configured: boolean;
  readonly scopes: string[];
  readonly canControl: boolean;
  readonly canReadLive: boolean;
  readonly onlineCount: number;
  readonly accountCount: number;
  readonly rooms: RoomSummary[];
  readonly selectedRoomIndex: number;
  readonly selectedRoomScrollId: string;
  readonly filteredDevices: Device[];
  readonly averageTemperature: number | null;
  readonly averageTemperatureText: string;
  readonly averageHumidity: number | null;
  readonly averageHumidityText: string;
  readonly apparentTemperature: number | null;
  readonly comfortText: string;
  readonly heroTone: string;
  readonly featuredProperty: Property | null;

  updateBaseUrl(value: string): void;
  updateApiKey(value: string): void;
  setRoom(room: string): void;
  clearError(): void;
  loadDevices(): Promise<void>;
  saveConnection(): Promise<ApiInfo | null>;
  clearConnection(): void;
  loadDeviceDetail(accountId: string, did: string): Promise<void>;
  previewProperty(key: string, value: unknown): void;
  writeProperty(key: string, value: unknown): Promise<void>;
  stepFeatured(direction: number): Promise<void>;
  runDeviceAction(key: string): Promise<void>;
}
