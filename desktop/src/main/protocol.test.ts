import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cspFor, NONCE_PLACEHOLDER, resolveAppPath, serveApp } from "./protocol.ts";

let root: string;
beforeAll(async () => {
  const base = await mkdtemp(join(tmpdir(), "aw-desktop-"));
  root = join(base, "renderer");
  await mkdir(join(root, "assets"), { recursive: true });
  await writeFile(
    join(root, "index.html"),
    `<meta name="csp-nonce" content="${NONCE_PLACEHOLDER}"><script src="/assets/a.js"></script>`,
  );
  await writeFile(join(root, "assets", "a.js"), "console.log(1)");
  await writeFile(join(base, "secret.txt"), "no");
});
afterAll(async () => {
  await rm(join(root, ".."), { recursive: true, force: true });
});

describe("resolveAppPath", () => {
  it("maps app://aw paths into the root and / to index.html", () => {
    expect(resolveAppPath(root, "app://aw/")).toBe(join(root, "index.html"));
    expect(resolveAppPath(root, "app://aw/assets/a.js")).toBe(join(root, "assets", "a.js"));
  });

  it("refuses another host, a path outside the root and a bad URL", () => {
    expect(resolveAppPath(root, "app://other/index.html")).toBeNull();
    // The URL parser clamps ".." and "%2e%2e" to the root; an encoded "/" is refused after decoding.
    expect(resolveAppPath(root, "app://aw/../secret.txt")).toBe(join(root, "secret.txt"));
    expect(resolveAppPath(root, "app://aw/%2e%2e/secret.txt")).toBe(join(root, "secret.txt"));
    expect(resolveAppPath(root, "app://aw/..%2Fsecret.txt")).toBeNull();
    expect(resolveAppPath(root, "app://aw/%E0%A4%A")).toBeNull();
    expect(resolveAppPath(root, "not a url")).toBeNull();
  });
});

describe("serveApp", () => {
  it("serves index.html with a CSP header and the same nonce in the meta tag", async () => {
    const first = await serveApp(root, "app://aw/index.html");
    const csp = first.headers.get("Content-Security-Policy")!;
    const nonce = /'nonce-([^']+)'/.exec(csp)![1]!;
    expect(csp).toBe(cspFor(nonce));
    expect(csp).toContain("script-src 'self'");
    expect(await first.text()).toContain(`content="${nonce}"`);
    const second = await serveApp(root, "app://aw/index.html");
    expect(second.headers.get("Content-Security-Policy")).not.toContain(nonce);
  });

  it("serves assets with their type and gives 404 outside the root", async () => {
    const js = await serveApp(root, "app://aw/assets/a.js");
    expect(js.headers.get("Content-Type")).toBe("text/javascript; charset=utf-8");
    expect((await serveApp(root, "app://aw/../secret.txt")).status).toBe(404);
    expect((await serveApp(root, "app://aw/missing.js")).status).toBe(404);
  });
});
