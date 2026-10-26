const TOKEN_KEY = "micheal.token";
const URL_KEY = "micheal.url";

export interface MichealConfig {
  readonly url: string;
  readonly token: string;
}

function fromQuery(): Partial<MichealConfig> {
  if (typeof window === "undefined") return {};
  const q = new URLSearchParams(window.location.search);
  const token = q.get("token")?.trim() || undefined;
  const url = q.get("url")?.trim() || undefined;
  if (token) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* ignore */
    }
  }
  if (url) {
    try {
      localStorage.setItem(URL_KEY, url);
    } catch {
      /* ignore */
    }
  }
  return { token, url };
}

function fromStorage(): Partial<MichealConfig> {
  if (typeof window === "undefined") return {};
  try {
    return {
      token: localStorage.getItem(TOKEN_KEY) || undefined,
      url: localStorage.getItem(URL_KEY) || undefined,
    };
  } catch {
    return {};
  }
}

/** Prefer same-origin when HUD is served from the cloud brain. */
function defaultUrl(): string {
  if (typeof window !== "undefined" && window.location?.protocol?.startsWith("http")) {
    const { hostname, origin } = window.location;
    if (hostname && hostname !== "127.0.0.1" && hostname !== "localhost") {
      return origin;
    }
  }
  return (
    import.meta.env.VITE_MICHEAL_URL ||
    import.meta.env.VITE_VIGIL_URL ||
    "http://127.0.0.1:8787"
  );
}

export function readConfig(): MichealConfig {
  const q = fromQuery();
  const s = fromStorage();
  const token =
    q.token ||
    s.token ||
    import.meta.env.VITE_MICHEAL_TOKEN ||
    import.meta.env.VITE_VIGIL_TOKEN ||
    "";
  const url = (q.url || s.url || defaultUrl()).replace(/\/$/, "");
  return { url, token };
}

/** Zero-input bootstrap from the live cloud (Jarvis opens already linked). */
export async function loadConfig(): Promise<MichealConfig> {
  const base = readConfig();
  try {
    const bootstrapUrl = `${base.url || defaultUrl()}/v1/bootstrap`;
    const res = await fetch(bootstrapUrl, { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as { token?: string; url?: string; ok?: boolean };
      if (data.token) {
        try {
          localStorage.setItem(TOKEN_KEY, data.token);
        } catch {
          /* ignore */
        }
        return {
          url: (data.url || base.url || defaultUrl()).replace(/\/$/, ""),
          token: data.token,
        };
      }
    }
  } catch {
    /* fall through */
  }
  // Dev / Electron fallback
  if (!base.token) {
    return {
      ...base,
      token:
        import.meta.env.VITE_MICHEAL_TOKEN ||
        import.meta.env.VITE_VIGIL_TOKEN ||
        "dev-token-change-me",
    };
  }
  return base;
}
