/** Help > About > Check for updates: the latest GitHub release against this build. */
export const REPO = "Arnav1771/fahh-ide";
export const RELEASES_URL = `https://github.com/${REPO}/releases`;
const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`;

/** -1, 0 or 1, like a sort comparator. "v0.6.10" > "0.6.9"; a pre-release sorts before its release. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre = ""] = v.trim().replace(/^v/i, "").split("-", 2);
    return { nums: core.split(".").map((n) => parseInt(n, 10) || 0), pre };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre > y.pre ? 1 : -1;
}

interface Asset {
  name: string;
  browser_download_url: string;
}

/** The installer that suits this machine, judged from the user agent; undefined when none does. */
export function assetFor(assets: Asset[], ua: string): Asset | undefined {
  const want = /Windows/i.test(ua) ? [/\.msi$/i, /setup.*\.exe$/i, /\.exe$/i] : /Mac/i.test(ua) ? [/\.dmg$/i] : [/\.AppImage$/i, /\.deb$/i];
  for (const re of want) {
    const a = assets.find((x) => re.test(x.name));
    if (a) return a;
  }
  return undefined;
}

export interface UpdateCheck {
  latest: string;
  newer: boolean;
  /** The release page. */
  url: string;
  /** A direct download for this platform, when the release has one. */
  download?: string;
}

export async function checkForUpdates(current: string, fetcher: typeof fetch = fetch, ua = typeof navigator === "undefined" ? "" : navigator.userAgent): Promise<UpdateCheck> {
  const res = await fetcher(LATEST_API, { headers: { Accept: "application/vnd.github+json" } });
  if (!res.ok) throw new Error(res.status === 403 ? "GitHub's rate limit was hit; try again in a while" : `GitHub answered ${res.status}`);
  const rel = (await res.json()) as { tag_name?: string; html_url?: string; assets?: Asset[] };
  if (!rel.tag_name) throw new Error("GitHub sent no release");
  const latest = rel.tag_name.replace(/^v/i, "");
  return {
    latest,
    newer: compareVersions(latest, current) > 0,
    url: rel.html_url ?? RELEASES_URL,
    download: assetFor(rel.assets ?? [], ua)?.browser_download_url,
  };
}

// ─── The quiet check at launch (Settings > Updates, on by default) ─────────────

export const UPDATE_CHECKED_KEY = "fahh-update-checked";
export const UPDATE_TOLD_KEY = "fahh-update-told";
const DAY = 24 * 60 * 60 * 1000;

type KV = Pick<Storage, "getItem" | "setItem">;

/**
 * At most once a day, and a toast once per new version: never a popup, never a nag.
 * Resolves to the toast text, or null when there is nothing to say (or the check failed).
 */
export async function launchUpdateCheck(
  enabled: boolean,
  store: KV,
  current: string,
  fetcher: typeof fetch = fetch,
  now = Date.now()
): Promise<string | null> {
  if (!enabled) return null;
  try {
    const last = Number(store.getItem(UPDATE_CHECKED_KEY));
    if (last > 0 && now >= last && now - last < DAY) return null;
    store.setItem(UPDATE_CHECKED_KEY, String(now));
    const r = await checkForUpdates(current, fetcher);
    if (!r.newer || store.getItem(UPDATE_TOLD_KEY) === r.latest) return null;
    store.setItem(UPDATE_TOLD_KEY, r.latest);
    return `Fahh ${r.latest} is out. Help > About Fahh Editor has the download.`;
  } catch {
    return null; // offline or rate-limited: say nothing, try again tomorrow
  }
}
