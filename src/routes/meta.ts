import { Router } from "express";
import { getVendor, listVendors } from "../core/registry.js";
import { AppError, toPublicError } from "../core/errors.js";

export const metaRouter = Router();

metaRouter.get("/vendors", (_req, res) => {
  res.json({ vendors: listVendors() });
});

metaRouter.get("/regions", (req, res) => {
  try {
    const vendorId = String(req.query.vendor || "xiaomi");
    const provider = getVendor(vendorId);
    res.json({ vendorId: provider.id, regions: provider.listRegions() });
  } catch (error) {
    res.status(error instanceof AppError ? error.status : 400).json(toPublicError(error));
  }
});
