export type PropValue = string | number | boolean | null;
export type AuthMode = "password" | "sms" | "qr";

export interface Region {
  id: string;
  name: string;
}

export interface VendorInfo {
  id: string;
  name: string;
  authModes: AuthMode[];
  regions: Region[];
}

export type AccountState = "ok" | "expired" | "unknown";

export interface AccountStatus {
  state: AccountState;
  checkedAt: number;
  message?: string;
}

export interface Account {
  accountId: string;
  vendorId: string;
  userId: string;
  region: string;
  status?: AccountStatus;
}

export interface OkSession {
  ok: true;
  accountId: string;
  accounts: Account[];
}

export interface LiveChip {
  name: string;
  text: string;
}

export interface Device {
  did: string;
  accountId: string;
  vendorId?: string;
  name: string;
  model: string;
  online: boolean;
  specType?: string;
  room: string;
  icon: string;
  live?: LiveChip[];
}

export interface ValueOption {
  value: PropValue;
  name: string;
}

/** 控件类型：由服务端 controls 层下发，前端只负责渲染 */
export type ControlKind = "switch" | "segmented" | "select" | "slider" | "number" | "text";

export interface DeviceProp {
  /** 档案层的稳定字段名，写回时带它，服务端据此选转换器 */
  id?: string;
  siid: number;
  piid: number;
  name: string;
  kind?: ControlKind;
  format?: string;
  unit?: string;
  writable: boolean;
  range: [number, number, number] | null;
  list: ValueOption[];
  value: PropValue;
}

export interface DeviceAction {
  id?: string;
  siid: number;
  aiid: number;
  name: string;
}

export interface DeviceService {
  siid: number;
  name: string;
  properties: DeviceProp[];
  actions: DeviceAction[];
}

export interface DeviceDetail {
  device: Device;
  services: DeviceService[];
}

export type PasswordLogin =
  | { needCaptcha: true; pendingId: string; vendor?: string }
  | { needEmailCode: true; pendingId: string; vendor?: string }
  | OkSession;

export type QrPoll = { pending: true } | OkSession;

export type ApiKeyScope = "devices:read" | "devices:live" | "devices:control";

export interface ApiKeyRow {
  id: string;
  prefix: string;
  name: string;
  scopes: ApiKeyScope[];
  createdAt: number;
  expiresAt: number;
  enabled: boolean;
  lastUsedAt: number;
  lastUsedPath: string;
  requestCount: number;
}

export interface CreatedKey {
  key: ApiKeyRow;
  secret: string;
}

export interface AuditRow {
  time: number;
  hubId: string;
  keyId: string;
  keyName: string;
  method: string;
  path: string;
  status: number;
  ms: number;
  ip: string;
  message?: string;
}

export function isOkSession(data: PasswordLogin | QrPoll | { ok?: boolean }): data is OkSession {
  return "ok" in data && data.ok === true && "accounts" in data;
}
