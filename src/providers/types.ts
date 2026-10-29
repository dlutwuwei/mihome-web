export type AuthMode = "password" | "sms" | "qr";

export interface RegionInfo {
  id: string;
  name: string;
}

export interface VendorInfo {
  id: string;
  name: string;
  authModes: AuthMode[];
  regions: RegionInfo[];
}

export interface LiveItem {
  name: string;
  text: string;
}

export interface DeviceSummary {
  did: string;
  accountId?: string;
  vendorId: string;
  name: string;
  model: string;
  online: boolean;
  room: string;
  icon: string;
  specType?: string;
  live?: LiveItem[];
}

export interface DeviceProperty {
  siid: number;
  piid: number;
  name: string;
  format: string;
  writable: boolean;
  range: number[] | null;
  list: Array<{ value: string | number | boolean; name: string }>;
  value?: unknown;
  error?: number;
}

export interface DeviceAction {
  siid: number;
  aiid: number;
  name: string;
}

export interface DeviceService {
  siid: number;
  name: string;
  properties: DeviceProperty[];
  actions: DeviceAction[];
}

export interface DeviceDetail {
  device: DeviceSummary;
  services: DeviceService[];
}

export interface BinaryImage {
  body: Buffer;
  type: string;
}

export interface VendorSession {
  vendorId: string;
  userId: string;
  region: string;
  devices: Map<string, DeviceSummary>;
  /** vendor-private auth/runtime state */
  state: unknown;
}

export type LoginOutcome =
  | { kind: "ok"; session: VendorSession }
  | { kind: "captcha"; pending: PendingAuth; captchaUrl: string }
  | { kind: "email"; pending: PendingAuth };

export interface PendingAuth {
  id?: string;
  vendorId: string;
  region: string;
  state: unknown;
  username?: string;
  password?: string;
  captchaUrl?: string;
  notificationUrl?: string;
  createdAt: number;
}

export interface VendorProvider {
  readonly id: string;
  readonly name: string;
  readonly authModes: AuthMode[];
  /** 该厂商可选的服务区域。 */
  listRegions(): RegionInfo[];
  /** 按区域创建一份未完成的登录上下文，供后续账密或扫码继续使用。 */
  createPending(region: string): PendingAuth;
  /** 账号密码登录。可能直接成功，或要求图形验证码、邮箱验证码。 */
  loginPassword(pending: PendingAuth, captcha?: string): Promise<LoginOutcome>;
  /** 用短信验证码完成登录。 */
  loginSms?(pending: PendingAuth): Promise<LoginOutcome>;
  /** 向手机号发送登录短信。需要图形验证码时返回 needCaptcha。 */
  sendSms?(pending: PendingAuth, captcha?: string): Promise<{ needCaptcha: boolean }>;
  /** 向账号邮箱发送二次验证码。 */
  beginEmail2fa?(pending: PendingAuth): Promise<PendingAuth>;
  /** 校验邮箱验证码并完成登录。 */
  verifyEmail2fa?(pending: PendingAuth, code: string): Promise<VendorSession>;
  /** 向厂商申请扫码登录，并把二维码地址写入 pending。 */
  beginQr?(pending: PendingAuth): Promise<PendingAuth>;
  /** 轮询扫码结果。未扫码时返回 null，扫码成功后返回会话。 */
  pollQr?(pending: PendingAuth): Promise<VendorSession | null>;
  /** 拉取图形验证码图片。 */
  getCaptchaImage?(pending: PendingAuth): Promise<BinaryImage>;
  /** 拉取登录二维码图片。 */
  getQrImage?(pending: PendingAuth): Promise<BinaryImage>;
  /** 拉取该账号下的设备列表，并写入 session.devices。 */
  listDevices(session: VendorSession): Promise<DeviceSummary[]>;
  /** 读取设备当前工作状态，按 did 返回展示文案。 */
  refreshLive(session: VendorSession, devices: DeviceSummary[]): Promise<Record<string, LiveItem[]>>;
  /** 读取单台设备的可控制属性和动作，并带上当前属性值。 */
  getDeviceDetail(session: VendorSession, did: string): Promise<DeviceDetail>;
  /** 写入设备属性，例如开关、亮度。 */
  setProperty(session: VendorSession, did: string, siid: number, piid: number, value: unknown): Promise<void>;
  /** 执行设备动作，例如开始清扫。 */
  runAction(session: VendorSession, did: string, siid: number, aiid: number): Promise<void>;
}
