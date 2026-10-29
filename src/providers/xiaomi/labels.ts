const LABELS: Record<string, string> = {
  "switch status": "开关",
  on: "开关",
  brightness: "亮度",
  "color temperature": "色温",
  mode: "模式",
  "target temperature": "目标温度",
  "fan level": "风速",
  status: "状态",
  temperature: "温度",
  "relative humidity": "湿度",
  humidity: "湿度",
  "pm2.5 density": "PM2.5",
  "battery level": "电量",
  fault: "故障",
};

const VALUE_ZH: Record<string, string> = {
  idle: "待机",
  sweeping: "清扫中",
  sweep: "清扫中",
  mopping: "拖地中",
  charging: "充电中",
  charged: "已充满",
  "go charging": "回充中",
  returning: "回充中",
  paused: "已暂停",
  pause: "暂停",
  cleaning: "清洁中",
  working: "工作中",
  sleep: "休眠",
  sleeping: "休眠",
  off: "关闭",
  on: "开启",
  auto: "自动",
  strong: "强档",
  medium: "中档",
  low: "低档",
  silent: "静音",
  favorite: "喜爱",
  fan: "送风",
  cool: "制冷",
  heat: "制热",
  dry: "除湿",
  none: "无",
  busy: "忙碌",
  error: "故障",
  normal: "正常",
  good: "优",
  moderate: "良",
  poor: "差",
  open: "打开",
  opened: "打开",
  close: "关闭",
  closed: "关闭",
};

export const UNITS: Record<string, string> = {
  celsius: "°C",
  fahrenheit: "°F",
  percentage: "%",
  "μg/m3": "μg/m³",
  ppm: "ppm",
  lux: "lx",
};

const LIVE_RULES: Array<[RegExp, number]> = [
  [/switch-status|switch status/, 100],
  [/fault/, 96],
  [/status/, 90],
  [/temperature/, 88],
  [/humidity/, 88],
  [/pm2\.?5|air-quality|aqi/, 86],
  [/battery/, 84],
  [/tds|water-quality|water quality/, 82],
  [/mode/, 80],
  [/brightness/, 70],
  [/fan-level|fan level/, 68],
];

export function zh(text: unknown) {
  const key = String(text || "").trim().toLowerCase();
  return VALUE_ZH[key] || LABELS[key] || String(text || "");
}

export function labelOf(text: unknown) {
  return zh(text) || "属性";
}

export function scoreLive(urn: string, desc: string) {
  const text = `${urn} ${desc}`;
  if (/serial-number|firmware|manufacturer|device-id|rssi/.test(text)) return -1;
  let score = 0;
  for (const [rule, weight] of LIVE_RULES) {
    if (rule.test(text)) score = Math.max(score, weight);
  }
  return score;
}
