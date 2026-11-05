import fs from "node:fs";
import path from "node:path";
import type { DeviceSummary } from "../providers/types.js";
import type { DeviceProfile, FieldRule } from "./types.js";

const builtin: DeviceProfile[] = [];
/** 档案层级：指定设备 > 指定型号 > 指定能力 > 厂商默认 */
const TIER = { did: 40, model: 30, specType: 20, vendor: 10 };

let dir = process.env.MIHOME_PROFILE_DIR || path.resolve("data/profiles");
let runtimeCache: { stamp: string; profiles: DeviceProfile[] } | null = null;

export interface ProfileView {
  /** 该字段的最终规则；omit 命中的字段会带 hidden: true */
  rule(key: string): FieldRule;
  order(): string[];
  groups(): Record<string, { name?: string; order?: number }>;
  action(key: string): { label?: string; hidden?: boolean; order?: number };
  profiles: Array<{ id: string; tier: number }>;
}

export function registerProfiles(profiles: DeviceProfile[]) {
  builtin.push(...profiles);
}

export function setProfileDir(next: string) {
  dir = path.resolve(next);
  runtimeCache = null;
}

export function getProfileDir() {
  return dir;
}

function globToRe(pattern: string) {
  const source = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}$`, "i");
}

function hit(pattern: string, value: string) {
  return pattern === value || globToRe(pattern).test(value);
}

/** 给 panel 层复用：order / actions 名单里写的也可以是通配模式 */
export function matchesPattern(pattern: string, key: string) {
  return hit(pattern, key);
}

function tierOf(profile: DeviceProfile, device: DeviceSummary) {
  if (profile.vendor !== device.vendorId) return -1;
  const match = profile.match;
  if (!match) return TIER.vendor;
  if (match.did?.some((pattern) => hit(pattern, device.did))) return TIER.did;
  if (match.model?.some((pattern) => hit(pattern, device.model))) return TIER.model;
  if (match.specType?.some((pattern) => hit(pattern, device.specType || ""))) return TIER.specType;
  return -1;
}

/**
 * 同层级内的特异度：精确名 > 字面最长的通配 > 字面短的 > 只写 "*" 的兜底。
 * omit 加一整档，所以同一份档案里“省略”是硬排除；
 * 想救回被误伤的字段靠更高一级的档案（型号 / 设备）重声明 hidden: false。
 */
function rank(tier: number, pattern: string, key: string, omit: boolean) {
  const literal = pattern.replace(/\*/g, "").length;
  const wildcards = pattern.split("*").length - 1;
  const spec = (pattern === key ? 10000 : literal * 100 - wildcards) + (omit ? 20000 : 0);
  return tier * 1000000 + spec * 10;
}

export function resolveProfile(device: DeviceSummary): ProfileView {
  const rows = [...builtin, ...runtimeProfiles()]
    .map((profile) => ({ profile, tier: tierOf(profile, device) }))
    .filter((row) => row.tier >= 0)
    .sort((a, b) => a.tier - b.tier);

  const rule = (key: string): FieldRule => {
    const hits: Array<{ at: number; rule: FieldRule }> = [];
    for (const { profile, tier } of rows) {
      for (const [pattern, fieldRule] of Object.entries(profile.fields || {})) {
        if (hit(pattern, key)) hits.push({ at: rank(tier, pattern, key, false), rule: fieldRule });
      }
      for (const pattern of profile.omit || []) {
        if (hit(pattern, key)) hits.push({ at: rank(tier, pattern, key, true), rule: { hidden: true } });
      }
    }
    hits.sort((a, b) => a.at - b.at);
    return hits.reduce<FieldRule>((merged, row) => Object.assign(merged, row.rule), {});
  };

  return {
    rule,
    order: () => {
      const keys: string[] = [];
      /* 高层级档案先出现，先声明者优先，未声明的字段排在后面 */
      for (const { profile } of [...rows].reverse()) {
        for (const key of profile.order || []) {
          if (!keys.includes(key)) keys.push(key);
        }
      }
      return keys;
    },
    groups: () => {
      const merged: Record<string, { name?: string; order?: number }> = {};
      for (const { profile } of rows) {
        for (const [key, group] of Object.entries(profile.groups || {})) merged[key] = { ...merged[key], ...group };
      }
      return merged;
    },
    action: (key: string) => {
      const merged: { label?: string; hidden?: boolean; order?: number } = {};
      for (const { profile } of rows) {
        for (const [pattern, actionRule] of Object.entries(profile.actions || {})) {
          if (hit(pattern, key)) Object.assign(merged, actionRule);
        }
      }
      return merged;
    },
    profiles: rows.map(({ profile, tier }) => ({ id: profile.id, tier })),
  };
}

/** provider 写回时取最终规则；设备信息缺失时退回厂商档案 */
export function resolveRule(device: DeviceSummary, key: string) {
  return resolveProfile(device).rule(key);
}

export function listProfiles(vendorId?: string) {
  return [...builtin, ...runtimeProfiles()].filter((profile) => !vendorId || profile.vendor === vendorId);
}

/** 把一台设备的手动配置落盘，下一次读取立刻生效 */
export function saveProfile(profile: DeviceProfile) {
  const target = path.join(dir, profile.vendor);
  fs.mkdirSync(target, { recursive: true });
  const file = path.join(target, `${profile.id}.json`);
  fs.writeFileSync(file, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
  runtimeCache = null;
  return file;
}

function stampOf(root: string) {
  const parts: string[] = [];
  const walk = (current: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".json")) parts.push(`${full}:${fs.statSync(full).mtimeMs}`);
    }
  };
  walk(root);
  return parts.sort().join("|");
}

function runtimeProfiles(): DeviceProfile[] {
  const stamp = stampOf(dir);
  if (runtimeCache && runtimeCache.stamp === stamp) return runtimeCache.profiles;
  const loaded: DeviceProfile[] = [];
  const walk = (current: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".json")) continue;
      try {
        const body = JSON.parse(fs.readFileSync(full, "utf8")) as DeviceProfile | DeviceProfile[];
        for (const profile of Array.isArray(body) ? body : [body]) {
          if (profile && typeof profile.vendor === "string" && typeof profile.id === "string") loaded.push(profile);
        }
      } catch {
        /* 某份配置写坏时跳过它，不影响设备读取 */
      }
    }
  };
  walk(dir);
  runtimeCache = { stamp, profiles: loaded };
  return loaded;
}
