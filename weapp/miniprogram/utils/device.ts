import type {
  ActionView,
  ChoiceView,
  Device,
  LiveItem,
  LiveMap,
  Property,
  PropertyKind,
  RawDevice,
  RawProperty,
  RawService,
  Service,
} from "../types";

export function deviceKey(device: Pick<RawDevice, "accountId" | "did">): string {
  return `${device.accountId || ""}:${device.did}`;
}

function appearanceFor(device: RawDevice, index: number): { glyph: string; accent: number } {
  const text = `${device.name || ""} ${device.model || ""}`;
  const rules: Array<[RegExp, string, number]> = [
    [/洗衣|washer|干衣/i, "洗", 3],
    [/冰箱|refrigerator|fridge/i, "冰", 0],
    [/加湿|humid/i, "湿", 3],
    [/空气净化|净化器|purifier/i, "净", 3],
    [/扫地|吸尘|vacuum/i, "扫", 3],
    [/打印机|print/i, "印", 2],
    [/灯|照明|light/i, "灯", 2],
    [/空调|温度|air condition|\bac\b/i, "温", 0],
    [/音乐|音箱|sound|speaker/i, "音", 1],
    [/摄像|相机|camera/i, "影", 0],
    [/电视|\btv\b/i, "视", 1],
    [/风扇|\bfan\b/i, "风", 3],
  ];
  if (device.vendorId === "pantum") return { glyph: "印", accent: 2 };
  const hit = rules.find(([pattern]) => pattern.test(text));
  if (hit) return { glyph: hit[1], accent: hit[2] };
  if (/^M\d/i.test(text)) return { glyph: "印", accent: 2 };
  return { glyph: "设", accent: index % 4 };
}

const SETPOINT_PATTERN = /设定|目标|冷藏|冷冻|变温|色温|除霜|化霜|洗涤|室外/;

// 家庭环境读数只应来自“空气类”设备：温度计/传感器、空调、温控器、新风、净化器、加湿器等。
const AMBIENT_DEVICE =
  /温度计|温湿度|传感器|空调|温控|新风|空气净化|净化器|加湿|temperature|hygrometer|humiture|thermostat|air\s*condition|purifier|humidifier|fresh[- ]?air|\bac\b/i;
// 内部温度代表不了房间环境的设备，命中即排除（优先级高于 AMBIENT_DEVICE）。
const NON_AMBIENT_DEVICE =
  /冰箱|冷藏|冷冻|变温|热水器|洗衣机|干衣|烘干|脱水|烤箱|微波炉|电烤|灯|照明|打印|音箱|音响|喇叭|电视|摄像|门铃|门锁|扫地|吸尘|窗帘|refrigerator|fridge|freezer|heater|water[- ]?heat|washer|dryer|oven|microwave|lamp|bulb|\blight\b|printer|speaker|audio|\btv\b|camera|doorbell|lock|vacuum|robot|curtain/i;

/** 判断设备是否为“会反映房间空气环境”的品类，只有这类设备的温湿度才纳入家庭均值。 */
export function isAmbientDevice(device: Pick<RawDevice, "name" | "model">): boolean {
  const text = `${device.name || ""} ${device.model || ""}`;
  if (NON_AMBIENT_DEVICE.test(text)) return false;
  return AMBIENT_DEVICE.test(text);
}

export function temperatureOf(live: LiveItem[]): number | null {
  for (const item of live) {
    const name = String(item.name || "");
    if (SETPOINT_PATTERN.test(name)) continue;
    if (!/温度|室温/.test(name)) continue;
    const match = String(item.text || "").match(/-?\d+(\.\d+)?/);
    if (match) return Number(match[0]);
  }
  return null;
}

export function humidityOf(live: LiveItem[]): number | null {
  for (const item of live) {
    const name = String(item.name || "");
    if (SETPOINT_PATTERN.test(name)) continue;
    if (!/湿度|humidity/i.test(name)) continue;
    const match = String(item.text || "").match(/\d+(\.\d+)?/);
    if (!match) continue;
    const value = Number(match[0]);
    if (Number.isFinite(value) && value >= 0 && value <= 100) return value;
  }
  return null;
}

/** 体感温度：高温高湿时用 Rothfusz 热指数修正，其余情况按实测温度。 */
export function apparentTemperatureOf(temperature: number | null, humidity: number | null): number | null {
  if (typeof temperature !== "number" || !Number.isFinite(temperature)) return null;
  const rh = typeof humidity === "number" && Number.isFinite(humidity) ? humidity : 50;
  if (temperature < 26.7 || rh < 40) return temperature;
  const fahrenheit = (temperature * 9) / 5 + 32;
  const heatIndex =
    -42.379 +
    2.04901523 * fahrenheit +
    10.14333127 * rh -
    0.22475541 * fahrenheit * rh -
    0.00683783 * fahrenheit * fahrenheit -
    0.05481717 * rh * rh +
    0.00122874 * fahrenheit * fahrenheit * rh +
    0.00085282 * fahrenheit * rh * rh -
    0.00000199 * fahrenheit * fahrenheit * rh * rh;
  return Math.round((((heatIndex - 32) * 5) / 9) * 10) / 10;
}

export function comfortOf(temperature: number | null, humidity: number | null): string {
  const feels = apparentTemperatureOf(temperature, humidity);
  if (feels === null) return "";
  const rh = typeof humidity === "number" && Number.isFinite(humidity) ? humidity : 50;
  if (feels < 10) return "体感寒冷";
  if (feels < 16) return "体感偏冷";
  if (feels < 20) return rh >= 70 ? "体感湿冷" : "体感微凉";
  if (feels < 26) {
    if (rh >= 70) return "体感偏闷";
    if (rh < 30) return "体感干燥";
    return "体感舒适";
  }
  if (feels < 30) return rh >= 65 ? "体感闷热" : "体感偏暖";
  if (feels < 36) return rh >= 65 ? "体感闷热" : "体感炎热";
  return "体感酷热";
}

export function decorateDevice(device: RawDevice, index: number, liveMap?: LiveMap | null): Device {
  const live = (liveMap && liveMap[deviceKey(device)]) || device.live || [];
  const appearance = appearanceFor(device, index);
  // 仅“空气类”品类参与家庭温湿度；其余设备（冰箱/热水器/洗衣机等）的内部读数不进入均值。
  const ambient = device.online && isAmbientDevice(device);
  return {
    ...device,
    accountId: device.accountId || "",
    vendorId: device.vendorId || "",
    model: device.model || "",
    room: device.room || "",
    icon: device.icon || "",
    key: deviceKey(device),
    glyph: appearance.glyph,
    accent: appearance.accent,
    statusText: device.online ? "在线" : "离线",
    primaryLive: live.length ? live[0].text : device.online ? "可控制" : "暂不可用",
    temperature: ambient ? temperatureOf(live) : null,
    humidity: ambient ? humidityOf(live) : null,
    live: live.slice(0, 3),
  };
}

export function inferKind(property: RawProperty): PropertyKind {
  if (property.kind) return property.kind;
  if (typeof property.value === "boolean") return "switch";
  if (property.list && property.list.length) return property.list.length <= 4 ? "segmented" : "select";
  if (property.range && property.range.length >= 2) return "slider";
  return typeof property.value === "number" ? "number" : "text";
}

export function formatPropertyValue(property: Property): string {
  const value = property.value;
  if (value === null || value === undefined || value === "") return "--";
  if (typeof value === "boolean") return value ? "开启" : "关闭";
  if (property.kind === "switch") return value ? "开启" : "关闭";
  const unit = property.unit || "";
  if (!unit) return String(value);
  return /^(°|%|℃|℉)/.test(unit) ? `${value}${unit}` : `${value} ${unit}`;
}

export function propertyKey(property: Pick<RawProperty, "siid" | "piid">): string {
  return `${property.siid}:${property.piid}`;
}

export function updatePropertyView(property: Property): void {
  property.displayValue = formatPropertyValue(property);
  property.options = (property.list || []).map(
    (option, index): ChoiceView => ({
      ...option,
      key: `${propertyKey(property)}:${index}`,
      selected: option.value === property.value,
    }),
  );
}

export function decorateServices(services: RawService[]): { services: Service[]; featuredKey: string } {
  let featuredKey = "";
  const decorated = services.map(
    (service): Service => ({
      ...service,
      key: `service:${service.siid}`,
      properties: (service.properties || []).map((source) => {
        const property: Property = {
          ...source,
          id: source.id || "",
          key: propertyKey(source),
          kind: inferKind(source),
          unit: source.unit || "",
          writable: Boolean(source.writable),
          hasRange: Array.isArray(source.range) && source.range.length >= 2,
          rangeMin: source.range && source.range.length >= 2 ? Number(source.range[0]) : 0,
          rangeMax: source.range && source.range.length >= 2 ? Number(source.range[1]) : 100,
          rangeStep: source.range && source.range.length >= 3 ? Number(source.range[2]) || 1 : 1,
          list: source.list || [],
          value: source.value,
          featured: false,
          displayValue: "",
          options: [],
        };
        if (!featuredKey && property.writable && property.hasRange && ["slider", "number"].includes(property.kind)) {
          featuredKey = property.key;
          property.featured = true;
        }
        updatePropertyView(property);
        return property;
      }),
      actions: (service.actions || []).map(
        (action): ActionView => ({
          ...action,
          key: `action:${action.siid}:${action.aiid}`,
        }),
      ),
    }),
  );
  return { services: decorated, featuredKey };
}

export function findProperty(services: Service[], key: string): Property | null {
  for (const service of services) {
    const property = service.properties.find((item) => item.key === key);
    if (property) return property;
  }
  return null;
}

export function findAction(services: Service[], key: string): { action: ActionView; service: Service } | null {
  for (const service of services) {
    const action = service.actions.find((item) => item.key === key);
    if (action) return { action, service };
  }
  return null;
}

export function clampPropertyValue(
  property: Pick<Property, "rangeMin" | "rangeMax" | "rangeStep">,
  value: unknown,
): number {
  const min = property.rangeMin;
  const max = property.rangeMax;
  const step = property.rangeStep || 1;
  const clamped = Math.min(max, Math.max(min, Number(value)));
  const stepped = min + Math.round((clamped - min) / step) * step;
  const precision = String(step).includes(".") ? String(step).split(".")[1].length : 0;
  return Number(stepped.toFixed(Math.min(precision, 6)));
}
