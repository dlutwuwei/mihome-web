type Method = "GET" | "POST" | "DELETE";

export async function api<T>(path: string, options: { method?: Method; body?: unknown } = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    method: options.method,
    headers: options.body == null ? undefined : { "Content-Type": "application/json" },
    body: options.body == null ? undefined : JSON.stringify(options.body),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

/** 开放接口用 Bearer 鉴权，供界面自测 API Key。 */
export async function apiBearer<T>(path: string, secret: string): Promise<T> {
  const response = await fetch(path, { headers: { Authorization: `Bearer ${secret}` } });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

export async function apiForm<T>(path: string, body: FormData): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", method: "POST", body });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

export function errorText(error: unknown) {
  return error instanceof Error ? error.message : "请求失败";
}
