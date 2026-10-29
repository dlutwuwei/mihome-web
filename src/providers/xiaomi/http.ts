export class CookieJar {
  map = new Map<string, string>();

  absorb(response: Response) {
    const lines = response.headers.getSetCookie?.() || [];
    for (const line of lines) {
      const pair = line.split(";")[0];
      const i = pair.indexOf("=");
      if (i < 1) continue;
      this.map.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }

  header() {
    return [...this.map.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  get(name: string) {
    return this.map.get(name) || "";
  }

  set(name: string, value: string) {
    this.map.set(name, value);
  }
}

export function parseJsonBody(text: string) {
  const raw = String(text || "").replace("&&&START&&&", "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function http(
  jar: CookieJar,
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    query?: Record<string, string | number | undefined>;
    body?: string;
  } = {},
) {
  const target = new URL(url);
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value != null) target.searchParams.append(key, String(value));
    }
  }
  const headers = { ...(options.headers || {}) };
  const cookie = jar.header();
  if (cookie) headers.cookie = cookie;
  const response = await fetch(target, {
    method: options.method || "GET",
    headers,
    body: options.body,
    redirect: "manual",
  });
  jar.absorb(response);
  const text = await response.text();
  return { status: response.status, headers: response.headers, text, url: target.toString() };
}

export async function follow(jar: CookieJar, start: string, ua: string) {
  let url = start;
  let last = await http(jar, url, {
    headers: { "User-Agent": ua, "Content-Type": "application/x-www-form-urlencoded" },
  });
  for (let i = 0; i < 6; i += 1) {
    const location = last.headers.get("location");
    if (last.status >= 300 && last.status < 400 && location) {
      url = new URL(location, url).toString();
      last = await http(jar, url, {
        headers: { "User-Agent": ua, "Content-Type": "application/x-www-form-urlencoded" },
      });
      continue;
    }
    return last;
  }
  return last;
}
