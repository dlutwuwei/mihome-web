import { Router } from "express";
import { getProfileDir, listCodecs, listProfiles, resolveProfile, saveProfile } from "../controls/index.js";
import type { ControlKind, DeviceProfile } from "../controls/types.js";
import { AppError, toPublicError } from "../core/errors.js";
import { getVendor } from "../core/registry.js";
import { accountsOf, getAccount, readHubId } from "../core/session.js";

export const profilesRouter = Router();

const KINDS: ControlKind[] = ["switch", "segmented", "select", "slider", "number", "text"];

function fail(res: import("express").Response, error: unknown) {
  res.status(error instanceof AppError ? error.status : 400).json(toPublicError(error));
}

/** 档案里能填的转换器与控件类型 */
profilesRouter.get("/options", (_req, res) => {
  res.json({ codecs: listCodecs(), kinds: KINDS, dir: getProfileDir() });
});

/** 现有档案：内置的加上 data/profiles 下的 JSON */
profilesRouter.get("/", (req, res) => {
  const vendor = typeof req.query.vendor === "string" ? req.query.vendor : undefined;
  res.json({ profiles: listProfiles(vendor) });
});

/** 已登录账号下的设备，供配置页挑选目标设备 */
profilesRouter.get("/devices", (req, res) => {
  const hubId = readHubId(req.headers.cookie);
  const rows = accountsOf(hubId).flatMap(({ accountId, session }) =>
    [...session.devices.values()].map((device) => ({ ...device, accountId })),
  );
  res.json({ devices: rows });
});

/** 一台设备最终命中的档案链，以及每个字段合并后的规则 */
profilesRouter.get("/resolve", async (req, res) => {
  const hubId = readHubId(req.headers.cookie);
  const accountId = String(req.query.accountId || "");
  const did = String(req.query.did || "");
  const session = getAccount(hubId, accountId);
  if (!session) return res.status(404).json({ error: "账号不存在" });
  const device = session.devices.get(did);
  if (!device) return res.status(404).json({ error: "请先刷新设备列表" });
  try {
    const provider = getVendor(session.vendorId);
    const detail = await provider.getDeviceDetail(session, did);
    const view = resolveProfile(device);
    res.json({
      device,
      matched: view.profiles,
      groups: view.groups(),
      order: view.order(),
      services: detail.services.map((service) => ({
        name: service.name,
        properties: service.properties.map((prop) => ({
          id: prop.id,
          name: prop.name,
          kind: prop.kind,
          writable: prop.writable,
          rule: view.rule(String(prop.id ?? "")),
        })),
        actions: service.actions.map((action) => ({
          id: action.id,
          name: action.name,
          rule: view.action(String(action.id ?? "")),
        })),
      })),
    });
  } catch (error) {
    fail(res, error);
  }
});

/** 保存档案到 data/profiles/<vendor>/<id>.json，下一次读取设备立刻生效 */
profilesRouter.put("/", (req, res) => {
  const body = req.body as DeviceProfile | undefined;
  try {
    if (!body || typeof body.id !== "string" || typeof body.vendor !== "string") {
      throw new AppError("档案需要 id 和 vendor", "PROFILE", 400);
    }
    const file = saveProfile(body);
    res.json({ ok: true, file });
  } catch (error) {
    fail(res, error);
  }
});
