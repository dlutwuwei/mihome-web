import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { registerProfiles } from "./profiles.js";
import { demoProfiles, pantumProfiles } from "./profiles/pantum.js";
import { mideaProfiles } from "./profiles/midea.js";
import { sgccProfiles } from "./profiles/sgcc.js";
import { xiaomiProfiles } from "./profiles/xiaomi.js";
import type { DeviceProfile } from "./types.js";

export * from "./types.js";
export * from "./codecs.js";
export {
  getProfileDir,
  listProfiles,
  matchesPattern,
  registerProfiles,
  resolveProfile,
  resolveRule,
  saveProfile,
  setProfileDir,
  type ProfileView,
} from "./profiles.js";
export { buildPanel, encodeFieldValue, formatPanelValue, panelLive } from "./panel.js";

/** 主要控制项配置：只决定保留哪些字段/动作，具体语义仍由 profiles 决定 */
function loadMainControls(): DeviceProfile[] {
  const file = fileURLToPath(new URL("./config/main-controls.json", import.meta.url));
  try {
    const body = JSON.parse(fs.readFileSync(file, "utf8")) as DeviceProfile[];
    return Array.isArray(body) ? body : [];
  } catch (error) {
    console.error("[controls] 读取主要控制项配置失败", file, error instanceof Error ? error.message : "");
    return [];
  }
}

/** 内置档案在启动时注册；data/profiles 下的 JSON 每次读取时按 mtime 生效 */
export function bootstrapProfiles() {
  registerProfiles([
    ...xiaomiProfiles,
    ...mideaProfiles,
    ...pantumProfiles,
    ...sgccProfiles,
    ...demoProfiles,
    ...loadMainControls(),
  ]);
}
