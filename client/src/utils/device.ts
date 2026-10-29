import type { Device, DeviceProp, LiveChip, PropValue } from "../types";

export function showValue(prop: DeviceProp) {
  if (prop.value == null) return "—";
  const hit = prop.list.find((item) => item.value === prop.value);
  return hit ? hit.name : String(prop.value);
}

export function cast(value: string): PropValue {
  if (value === "true") return true;
  if (value === "false") return false;
  const number = Number(value);
  return Number.isNaN(number) ? value : number;
}

export function deviceKey(device: Pick<Device, "accountId" | "did">) {
  return `${device.accountId}:${device.did}`;
}

export function mergeLive(devices: Device[], live: Record<string, LiveChip[]>) {
  return devices.map((device) => {
    const next = live[deviceKey(device)];
    return next ? { ...device, live: next } : device;
  });
}

export function devicePath(accountId: string, did: string) {
  return `/api/devices/${encodeURIComponent(accountId)}/${encodeURIComponent(did)}`;
}
