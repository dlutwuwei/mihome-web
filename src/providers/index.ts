import { bootstrapProfiles } from "../controls/index.js";
import { registerVendor } from "../core/registry.js";
import { demoProvider } from "./demo/index.js";
import { mideaProvider } from "./midea/index.js";
import { pantumProvider } from "./pantum/index.js";
import { xiaomiProvider } from "./xiaomi/index.js";

export function bootstrapProviders() {
  bootstrapProfiles();
  registerVendor(xiaomiProvider);
  registerVendor(mideaProvider);
  registerVendor(pantumProvider);
  registerVendor(demoProvider);
}

export { xiaomiProvider, mideaProvider, pantumProvider, demoProvider };
