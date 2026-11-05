import type { DeviceProfile } from "../types.js";

/**
 * 米家的属性约束本来就写在 MIoT spec 里，适配器已经把 format / range / value-list 透传出来，
 * 所以这里只做规范里缺的东西：单位、控件偏好、按品类排序，以及个别动作改名。
 * 字段键是 "<service>.<property>"，因此可以用 "*.brightness" 一次覆盖所有品类。
 */
export const xiaomiProfiles: DeviceProfile[] = [
  {
    id: "xiaomi-baseline",
    vendor: "xiaomi",
    fields: {
      "*.brightness": { unit: "%", kind: "slider" },
      "*.color-temperature": { unit: "K", kind: "slider" },
      "*.fan-level": { kind: "slider" },
      "*.target-temperature": { unit: "°C" },
      "*.temperature": { unit: "°C" },
      "*.humidity": { unit: "%" },
      "*.pm2.5-density": { unit: "μg/m³" },
    },
  },
  {
    id: "xiaomi-light",
    vendor: "xiaomi",
    match: { specType: ["*:instance:light*"] },
    order: ["*.on", "*.brightness", "*.color-temperature"],
  },
  {
    id: "xiaomi-fan",
    vendor: "xiaomi",
    match: { specType: ["*:instance:fan*"] },
    order: ["*.on", "*.fan-level", "*.mode"],
  },
  {
    id: "xiaomi-vacuum",
    vendor: "xiaomi",
    match: { specType: ["*:instance:vacuum*"] },
    actions: { "2.1": { label: "开始清扫" }, "2.2": { label: "回充" } },
  },
];
