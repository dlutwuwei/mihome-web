import type { DeviceProfile } from "../types.js";

export const sgccProfiles: DeviceProfile[] = [
  {
    id: "sgcc-meter",
    vendor: "sgcc",
    match: { model: ["sgcc.meter"] },
    groups: { 本月: { order: 1 }, 每日用电: { order: 2 }, 每月用电: { order: 3 } },
    order: ["monthPq", "monthAmt", "balance", "owe", "addr", "dayTable", "monthTable"],
    fields: {
      monthPq: { label: "当月用电", unit: "kWh", group: "本月" },
      monthAmt: { label: "当月电费", unit: "元", group: "本月" },
      balance: { label: "账户余额", unit: "元", group: "本月" },
      owe: { label: "欠费", unit: "元", group: "本月" },
      addr: { label: "用电地址", group: "本月" },
      dayTable: { label: "每日用电", kind: "table", group: "每日用电" },
      monthTable: { label: "每月用电", kind: "table", group: "每月用电" },
    },
  },
];
