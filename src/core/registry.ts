import type { VendorInfo, VendorProvider } from "../providers/types.js";
import { AppError } from "./errors.js";

const providers = new Map<string, VendorProvider>();

export function registerVendor(provider: VendorProvider) {
  providers.set(provider.id, provider);
}

export function getVendor(id: string): VendorProvider {
  const provider = providers.get(id);
  if (!provider) throw new AppError(`不支持的厂商: ${id}`, "VENDOR", 400);
  return provider;
}

export function listVendors(): VendorInfo[] {
  return [...providers.values()].map((provider) => ({
    id: provider.id,
    name: provider.name,
    authModes: provider.authModes,
    regions: provider.listRegions(),
  }));
}
