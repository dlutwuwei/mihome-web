import { registerProfiles } from "./profiles.js";
import { demoProfiles, pantumProfiles } from "./profiles/pantum.js";
import { mideaProfiles } from "./profiles/midea.js";
import { xiaomiProfiles } from "./profiles/xiaomi.js";

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
export { buildPanel, encodeFieldValue, formatPanelValue } from "./panel.js";

/** 内置档案在启动时注册；data/profiles 下的 JSON 每次读取时按 mtime 生效 */
export function bootstrapProfiles() {
  registerProfiles([...xiaomiProfiles, ...mideaProfiles, ...pantumProfiles, ...demoProfiles]);
}
