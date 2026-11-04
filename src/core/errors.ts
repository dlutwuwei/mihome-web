export class AppError extends Error {
  code: string | number;
  status: number;
  details?: Record<string, unknown>;

  constructor(message: string, code: string | number = "ERROR", status = 400, details?: Record<string, unknown>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const AUTH_CODES = new Set(["AUTH", "401", "403"]);
const AUTH_HINTS = /(token|unauthor|forbidden|auth|login|expired|expire|登录|登陆|过期|失效|凭证|未授权|重新登录)/i;

/** 判断错误是否表示登录态失效，而不是网络或厂商服务异常。 */
export function isAuthFailure(error: unknown) {
  if (error instanceof AppError) {
    if (AUTH_CODES.has(String(error.code))) return true;
    if (AUTH_CODES.has(String(error.status))) return true;
  }
  const message = error instanceof Error ? error.message : "";
  return AUTH_HINTS.test(message);
}

export function toPublicError(error: unknown) {
  if (error instanceof AppError) {
    return { error: error.message, code: error.code, ...error.details };
  }
  if (error instanceof Error) {
    const code = (error as Error & { code?: string | number }).code ?? "";
    return { error: error.message || "请求失败", code };
  }
  return { error: "请求失败", code: "" };
}
