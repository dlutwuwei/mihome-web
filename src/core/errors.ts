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
