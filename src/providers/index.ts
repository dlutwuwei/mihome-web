import { registerVendor } from "../core/registry.js";
import { demoProvider } from "./demo/index.js";
import { mideaProvider } from "./midea/index.js";
import { xiaomiProvider } from "./xiaomi/index.js";

export function bootstrapProviders() {
  registerVendor(xiaomiProvider);
  registerVendor(mideaProvider);
  registerVendor(demoProvider);
}

export { xiaomiProvider, mideaProvider, demoProvider };
