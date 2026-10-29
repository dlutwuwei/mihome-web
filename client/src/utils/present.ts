import type { Device, LiveChip } from "../types";

export function shortVendor(name: string) {
  if (/小米|米家/.test(name)) return "小米";
  if (name.includes("美的")) return "美的";
  const head = name.split(/[/·|\s]/)[0];
  return head || name || "厂商";
}

export function placeOf(device: Device) {
  const hit = device.name.match(/主卧|次卧|门厅|客厅|厨房|阳台|卫生间/);
  if (hit) return hit[0];
  return device.room || "未分区";
}

export function climatePlace(device: Device, group: Device[]) {
  const place = placeOf(device);
  const duplicated = group.some((item) => item !== device && item.vendorId === device.vendorId && placeOf(item) === place);
  if (!duplicated) return place;
  const short = device.name.replace(/温湿度计|温度计|湿度计/g, "").trim();
  return short || device.name;
}

function parseNum(text: string) {
  const matched = text.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!matched) return null;
  const value = Number(matched[0]);
  return Number.isFinite(value) ? value : null;
}

function isTempName(name: string) {
  if (/色温|目标|color temperature/i.test(name)) return false;
  return /温度|temperature/i.test(name);
}

function isFaultName(name: string) {
  return /故障|fault/i.test(name);
}

function faultOk(text: string) {
  return /^(0|无|正常|无故障|关|否|false|no)$/i.test(text.trim());
}

export function isClimate(device: Device) {
  if (/温湿度|温度计|湿度计/.test(device.name)) return true;
  if (device.specType?.includes("temperature-humidity-sensor")) return true;
  const live = device.live || [];
  const sensor = live.some((item) => isTempName(item.name) || /湿度|humidity/i.test(item.name));
  const control = live.some((item) => /开关|状态|模式/.test(item.name));
  return sensor && !control;
}

function findChip(live: LiveChip[], test: (name: string) => boolean) {
  return live.find((item) => test(item.name));
}

export function batteryOf(device: Device) {
  const chip = findChip(device.live || [], (name) => /电量|battery/i.test(name));
  if (!chip) return null;
  return parseNum(chip.text);
}

function tempOf(device: Device) {
  const chip = findChip(device.live || [], isTempName);
  if (!chip) return null;
  return parseNum(chip.text);
}

function humidityOf(device: Device) {
  const chip = findChip(device.live || [], (name) => /湿度|humidity/i.test(name));
  if (!chip) return null;
  return parseNum(chip.text);
}

export interface ClimateView {
  device: Device;
  place: string;
  temp: string | null;
  humidity: string | null;
  battery: string | null;
  low: boolean;
}

export function climateView(device: Device): ClimateView {
  const temp = tempOf(device);
  const humidity = humidityOf(device);
  const battery = batteryOf(device);
  return {
    device,
    place: placeOf(device),
    temp: temp == null ? null : `${temp.toFixed(1)}°`,
    humidity: humidity == null ? null : `${Math.round(humidity)}%`,
    battery: battery == null ? null : `${Math.round(battery)}%`,
    low: battery != null && battery <= 20,
  };
}

export interface HomeSummary {
  average: number | null;
  humidity: number | null;
  driest: { place: string; value: number } | null;
  lowBattery: number;
}

export function summarize(devices: Device[]): HomeSummary {
  const climates = devices.filter(isClimate);
  const temps = climates.map(tempOf).filter((value): value is number => value != null);
  const hums = climates.flatMap((device) => {
    const value = humidityOf(device);
    return value == null ? [] : [{ place: placeOf(device), value }];
  });
  const driest = hums.length > 1 ? hums.reduce((best, item) => (item.value < best.value ? item : best)) : null;
  return {
    average: temps.length ? Math.round(temps.reduce((sum, value) => sum + value, 0) / temps.length) : null,
    humidity: hums.length ? Math.round(hums.reduce((sum, item) => sum + item.value, 0) / hums.length) : null,
    driest: driest ? { place: driest.place, value: Math.round(driest.value) } : null,
    lowBattery: devices.filter((device) => {
      const battery = batteryOf(device);
      return battery != null && battery <= 20;
    }).length,
  };
}

export interface RunningView {
  device: Device;
  place: string;
  mode: "text" | "pair";
  text: string;
  left: string;
  leftLabel: string;
  right: string;
  rightLabel: string;
  meta: string;
}

function figure(text: string) {
  const value = parseNum(text);
  if (value == null) return text;
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
}

function waterLabel(name: string, index: number) {
  if (/出|output/i.test(name)) return "出水";
  if (/进|input/i.test(name)) return "进水";
  const han = name.match(/[\u4e00-\u9fa5]{1,4}/);
  if (han) return han[0];
  return index === 0 ? "进水" : "出水";
}

function readable(text: string) {
  const value = text.trim();
  if (!value) return "";
  if (/[\u4e00-\u9fa5°%]/.test(value)) return value;
  if (/^on$/i.test(value)) return "开";
  if (/^off$/i.test(value)) return "关";
  return "";
}

function statusText(live: LiveChip[]) {
  const status = findChip(live, (name) => name === "状态" || /^status$/i.test(name));
  const statusWords = status ? readable(status.text) : "";
  if (statusWords && !faultOk(statusWords)) return statusWords;
  const mode = live.find((item) => /模式|(^|_)mode$/i.test(item.name));
  const modeWords = mode ? readable(mode.text) : "";
  if (modeWords && !/^(关|关闭)$/.test(modeWords)) return modeWords;
  const target = findChip(live, (name) => /目标温度/.test(name));
  if (target) {
    const value = parseNum(target.text);
    if (value != null) return `${Number.isInteger(value) ? value : value.toFixed(1)}°`;
    const words = readable(target.text);
    if (words) return words;
  }
  const power = findChip(live, (name) => name === "开关" || /^开关/.test(name));
  const powerWords = power ? readable(power.text) : "";
  if (powerWords === "开" || powerWords === "开启") return "已开启";
  if (powerWords === "关" || powerWords === "关闭") return "已关闭";
  if (powerWords) return powerWords;
  return "在线";
}

function faultNote(live: LiveChip[]) {
  const faults = live.filter((item) => isFaultName(item.name));
  if (!faults.length) return "";
  const bad = faults.find((item) => !faultOk(item.text));
  if (!bad) return "无故障";
  const words = readable(bad.text);
  if (words && !/^(开|关)$/.test(words)) return words;
  if (/[\u4e00-\u9fa5]/.test(bad.name)) return bad.name;
  return "";
}

export function runningView(device: Device): RunningView {
  const live = device.live || [];
  const waters = live.filter((item) => /溶解|tds|进水|出水|water/i.test(item.name)).slice(0, 2);
  const note = faultNote(live);
  const place = placeOf(device);
  if (waters.length >= 2) {
    const pair = waters.map((item, index) => ({
      value: figure(item.text),
      label: waterLabel(item.name, index),
    }));
    pair.sort((a, b) => Number(a.label === "出水") - Number(b.label === "出水"));
    const status = findChip(live, (name) => name === "状态");
    const meta = ["在线", status?.text || "", note].filter(Boolean).join(" · ");
    return {
      device,
      place,
      mode: "pair",
      text: "",
      left: pair[0].value,
      leftLabel: pair[0].label,
      right: pair[1].value,
      rightLabel: pair[1].label,
      meta,
    };
  }
  return {
    device,
    place,
    mode: "text",
    text: statusText(live),
    left: "",
    leftLabel: "",
    right: "",
    rightLabel: "",
    meta: ["在线", note].filter(Boolean).join(" · "),
  };
}
