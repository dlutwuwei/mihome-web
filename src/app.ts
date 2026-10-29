import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authRouter } from "./routes/auth.js";
import { devicesRouter } from "./routes/devices.js";
import { metaRouter } from "./routes/meta.js";

const root = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "64kb" }));
  app.use("/api", metaRouter);
  app.use("/api", authRouter);
  app.use("/api/devices", devicesRouter);
  app.use(express.static(path.join(root, "../public")));
  return app;
}
