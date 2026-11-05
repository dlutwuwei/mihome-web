import type { DeviceProfile } from "../types.js";

/** 奔图云端只给打印状态，面板靠档案把固定字段和上传打印动作摆清楚 */
export const pantumProfiles: DeviceProfile[] = [
  {
    id: "pantum-baseline",
    vendor: "pantum",
    groups: { 打印: { order: 1 }, 读数: { order: 2 } },
    fields: {
      sn: { label: "序列号", group: "读数" },
      status: { label: "云端状态", group: "读数" },
    },
    actions: { print: { label: "上传打印" } },
  },
];

/** 演示厂商：把内存里的 on / brightness 映射成控件 */
export const demoProfiles: DeviceProfile[] = [
  {
    id: "demo-baseline",
    vendor: "demo",
    groups: { 灯光: { order: 1 } },
    order: ["on", "brightness"],
    fields: {
      on: { label: "开关", kind: "switch", codec: "bool", group: "灯光" },
      brightness: { label: "亮度", kind: "slider", unit: "%", min: 1, max: 100, step: 1, codec: "shapenum", group: "灯光" },
    },
  },
];
