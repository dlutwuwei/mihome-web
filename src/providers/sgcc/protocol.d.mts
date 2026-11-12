export const SG_BASE: string;
export const PATHS: { LOGIN: string; SMS: string; DAILY: string; MONTH: string; BAL: string };
export function createDeviceState(): {
  seed: string;
  boot: number;
  install: number;
  tok: { token: string; time: string; ts: number } | null;
};
export function md5hex(input: string | Uint8Array): string;
export function cnNow(): { s14: string; ms: string; y: number; m: number; d: number };

export class SgError extends Error {
  code: string;
  constructor(code: string, msg?: string);
}

export class SgClient {
  user: string;
  pass: string;
  deviceState: ReturnType<typeof createDeviceState>;
  sess: {
    user: string;
    token: string;
    userId: string;
    province: string;
    exp: number;
    accounts: Array<{
      consNo: string;
      src?: string;
      pro?: string;
      org?: string;
      elec?: string;
      name?: string;
      addr?: string;
    }>;
  } | null;
  constructor(opts: {
    username: string;
    password: string;
    deviceState?: ReturnType<typeof createDeviceState>;
  });
  login(code?: string, codeKey?: string): Promise<NonNullable<SgClient["sess"]>>;
  sendDeviceSms(): Promise<string>;
  authed(path: string, payload: Record<string, unknown>): Promise<Record<string, unknown>>;
}
