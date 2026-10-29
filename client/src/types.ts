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

export interface Account {
  accountId: string;
  vendorId: string;
  userId: string;
  region: string;
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

export interface DeviceProp {
  siid: number;
  piid: number;
  name: string;
  format?: string;
  writable: boolean;
  range: [number, number, number] | null;
  list: ValueOption[];
  value: PropValue;
}

export interface DeviceAction {
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

export function isOkSession(data: PasswordLogin | QrPoll | { ok?: boolean }): data is OkSession {
  return "ok" in data && data.ok === true && "accounts" in data;
}
