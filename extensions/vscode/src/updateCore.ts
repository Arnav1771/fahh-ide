// Self-update core: no vscode import, so it unit-tests under plain node.
// Copied as-is into each Stealth Keqing extension (separate products, no shared package).
import * as https from "https";

export interface Latest {
  version: string;
  url: string;
  notes: string;
}

export const MAX_VSIX_BYTES = 20 * 1024 * 1024;
export const MAX_JSON_BYTES = 64 * 1024;
export const TIMEOUT_MS = 30_000;

// ponytail: x.y.z only; a pre-release/build suffix is ignored (1.2.0-beta == 1.2.0).
export function parseVersion(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]*)?$/.exec(String(v).trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** <0 if a<b, 0 if equal, >0 if a>b. Unparseable versions throw. */
export function compareSemver(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) throw new Error(`not a version: ${pa ? b : a}`);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/** Only plain https on an allowed host (no credentials, no custom port). */
export function isAllowedUrl(url: string, hosts: readonly string[]): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return u.protocol === "https:" && hosts.includes(u.hostname.toLowerCase()) && !u.username && !u.password && u.port === "";
}

/** Parse and validate latest.json: {"version":"x.y.z","url":"https://.../x.vsix","notes":"..."}. */
export function parseLatest(text: string, hosts: readonly string[]): Latest {
  const j = JSON.parse(text) as Record<string, unknown>;
  if (!j || typeof j !== "object") throw new Error("latest.json is not an object");
  const { version, url, notes } = j;
  if (typeof version !== "string" || !parseVersion(version)) throw new Error(`bad version in latest.json: ${String(version)}`);
  if (typeof url !== "string" || !isAllowedUrl(url, hosts) || !new URL(url).pathname.endsWith(".vsix")) throw new Error(`refusing update url: ${String(url)}`);
  return { version, url, notes: typeof notes === "string" ? notes : "" };
}

/** GET over https, following up to 5 redirects; every hop must pass isAllowedUrl. */
export function fetchBuffer(url: string, hosts: readonly string[], maxBytes: number, timeoutMs = TIMEOUT_MS): Promise<Buffer> {
  const signal = AbortSignal.timeout(timeoutMs);
  const get = (u: string, hops: number): Promise<Buffer> =>
    new Promise((resolve, reject) => {
      if (!isAllowedUrl(u, hosts)) return reject(new Error(`refusing url: ${u}`));
      https
        .get(u, { signal, headers: { "user-agent": "vscode-extension-self-update" } }, (res) => {
          const status = res.statusCode ?? 0;
          if (status >= 300 && status < 400 && res.headers.location) {
            res.resume();
            if (hops >= 5) return reject(new Error("too many redirects"));
            return get(new URL(res.headers.location, u).toString(), hops + 1).then(resolve, reject);
          }
          if (status !== 200) {
            res.resume();
            return reject(new Error(`HTTP ${status} for ${u}`));
          }
          if (Number(res.headers["content-length"] ?? 0) > maxBytes) {
            res.destroy();
            return reject(new Error(`${u} is larger than ${maxBytes} bytes`));
          }
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (c: Buffer) => {
            size += c.length;
            if (size > maxBytes) res.destroy(new Error(`${u} is larger than ${maxBytes} bytes`));
            else chunks.push(c);
          });
          res.on("error", reject);
          res.on("end", () => resolve(Buffer.concat(chunks)));
        })
        .on("error", reject);
    });
  return get(url, 0);
}
