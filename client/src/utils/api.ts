export async function api<T>(path: string, options: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<T> {
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

export function errorText(error: unknown) {
  return error instanceof Error ? error.message : "请求失败";
}
