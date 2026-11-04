import { AppError, isAuthFailure } from "./errors.js";
import { getVendor } from "./registry.js";
import { accountsOf, listAccounts, markAccountStatus, type AccountStatus } from "./session.js";
import type { VendorSession } from "../providers/types.js";

const CHECK_TIMEOUT_MS = 8000;

async function withTimeout<T>(task: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new AppError("检查登录状态超时", "TIMEOUT", 504)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function probe(session: VendorSession) {
  const provider = getVendor(session.vendorId);
  if (!provider.checkSession) throw new AppError("该厂商暂不支持检查登录状态", "UNSUPPORTED", 501);
  await provider.checkSession(session);
}

function messageOf(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return "检查失败";
}

/** 逐个确认账号登录态，缓存结果并返回最新账号视图。 */
export async function checkAccounts(hubId: string) {
  const rows = accountsOf(hubId);
  await Promise.all(rows.map(async ({ accountId, session }) => {
    let status: AccountStatus;
    try {
      await withTimeout(probe(session), CHECK_TIMEOUT_MS);
      status = { state: "ok", checkedAt: Date.now() };
    } catch (error) {
      const message = messageOf(error);
      status = isAuthFailure(error)
        ? { state: "expired", checkedAt: Date.now(), message }
        : { state: "unknown", checkedAt: Date.now(), message };
    }
    markAccountStatus(hubId, accountId, status);
  }));
  return listAccounts(hubId);
}
