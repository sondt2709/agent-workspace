// The `app://` protocol: main serves the built renderer from `out/renderer/` with a CSP that has a
// new nonce for each page load (docs/tech-stack.md 1.4 "Renderer security" and "CSP"). The same
// nonce goes into the `csp-nonce` meta tag, and the renderer gives it to the Emotion cache.
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

export const APP_SCHEME = "app";
export const APP_HOST = "aw";
export const APP_URL = `${APP_SCHEME}://${APP_HOST}/index.html`;

/** The placeholder of the nonce in `index.html`. */
export const NONCE_PLACEHOLDER = "__AW_CSP_NONCE__";

export function newNonce(): string {
  return randomBytes(16).toString("base64");
}

/** The CSP of a page load with the nonce `nonce`. */
export function cspFor(nonce: string): string {
  return [
    "default-src 'none'",
    "script-src 'self'",
    `style-src-elem 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/**
 * The file of an `app://aw/<path>` URL inside `root`, or null for another host, a path outside
 * `root` or a bad URL. `/` is `index.html`.
 */
export function resolveAppPath(root: string, url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${APP_SCHEME}:` || parsed.host !== APP_HOST) return null;
  let path: string;
  try {
    path = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
  if (path.includes("\0")) return null;
  const base = resolve(root);
  const file = resolve(base, `.${path === "/" ? "/index.html" : path}`);
  return file.startsWith(base + sep) ? file : null;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

/** Answers one `app://` request. */
export async function serveApp(root: string, url: string): Promise<Response> {
  const file = resolveAppPath(root, url);
  if (file === null) return new Response("Not found", { status: 404 });
  let body: Buffer;
  try {
    body = await readFile(file);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const type = TYPES[extname(file)] ?? "application/octet-stream";
  if (extname(file) !== ".html") {
    return new Response(new Uint8Array(body), { headers: { "Content-Type": type } });
  }
  const nonce = newNonce();
  const html = body.toString("utf8").replaceAll(NONCE_PLACEHOLDER, nonce);
  return new Response(html, {
    headers: { "Content-Type": type, "Content-Security-Policy": cspFor(nonce) },
  });
}
