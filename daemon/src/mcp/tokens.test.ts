// Unit tests of the session tokens (add-mcp-server, decision 3).
import { createRedactor } from "@aw/core";
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { tempDir } from "../testing.ts";
import { bearerToken, SessionTokens, tokenFile } from "./tokens.ts";

const S1 = "0193a7d1-0000-7000-8000-000000000001";
const S2 = "0193a7d1-0000-7000-8000-000000000002";
let home = "";

afterEach(async () => {
  if (home) await rm(home, { recursive: true, force: true });
  home = "";
});

async function setup(): Promise<SessionTokens> {
  home = await tempDir("awt-");
  for (const s of [S1, S2]) await mkdir(join(home, "sessions", s), { recursive: true });
  return new SessionTokens(home);
}

describe("session tokens", () => {
  it("mints one token per session in a 0600 file, and keeps it over a resume", async () => {
    const tokens = await setup();
    const first = await tokens.ensure(S1);
    expect(first).toMatch(/^awt_[A-Za-z0-9_-]{43}$/);
    expect(statSync(tokenFile(home, S1)).mode & 0o777).toBe(0o600);
    expect((await readFile(tokenFile(home, S1), "utf8")).trim()).toBe(first);
    expect(await tokens.ensure(S1)).toBe(first);
    const second = await tokens.ensure(S2);
    expect(second).not.toBe(first);
    expect(tokens.session(first)).toBe(S1);
    expect(tokens.session(second)).toBe(S2);
  });

  it("gives each live token to the redaction, and tells each change", async () => {
    const tokens = await setup();
    let changes = 0;
    tokens.onChange(() => (changes += 1));
    const token = await tokens.ensure(S1);
    expect(changes).toBe(1);
    // A resume keeps the token: no change.
    await tokens.ensure(S1);
    expect(changes).toBe(1);
    expect(tokens.secrets()).toEqual([{ name: "mcp-token", value: token }]);
    const redactor = createRedactor(tokens.secrets());
    expect(redactor.redactText(`curl -H "Authorization: Bearer ${token}"`)).toBe(
      'curl -H "Authorization: Bearer [redacted:mcp-token]"',
    );
    // The base64 form inside an HTTP Basic auth header.
    expect(redactor.redactText(Buffer.from(`x:${token}`).toString("base64"))).toContain(
      "[redacted:mcp-token]",
    );
    await tokens.revoke(S1);
    expect(changes).toBe(2);
    expect(tokens.secrets()).toEqual([]);
  });

  it("finds no session for an unknown, malformed or revoked token", async () => {
    const tokens = await setup();
    const token = await tokens.ensure(S1);
    expect(tokens.session(`awt_${"A".repeat(43)}`)).toBeNull();
    expect(tokens.session("none")).toBeNull();
    expect(tokens.session(`${token}x`)).toBeNull();
    await tokens.revoke(S1);
    expect(tokens.session(token)).toBeNull();
    expect(existsSync(tokenFile(home, S1))).toBe(false);
    expect(tokens.size).toBe(0);
  });

  it("loads the token of a running session after a restart, and never mints on a load", async () => {
    const tokens = await setup();
    const token = await tokens.ensure(S1);
    const restarted = new SessionTokens(home);
    expect(await restarted.load(S1)).toBe(true);
    expect(restarted.session(token)).toBe(S1);
    expect(await restarted.load(S2)).toBe(false);
    expect(existsSync(tokenFile(home, S2))).toBe(false);
    // A damaged file is not a token: ensure() writes a new one.
    await writeFile(tokenFile(home, S2), "not a token\n");
    expect(await restarted.load(S2)).toBe(false);
    expect(await restarted.ensure(S2)).toMatch(/^awt_/);
  });

  it("reads the bearer token of an Authorization header", () => {
    expect(bearerToken("Bearer awt_abc")).toBe("awt_abc");
    expect(bearerToken("bearer  awt_abc ")).toBe("awt_abc");
    expect(bearerToken(["Bearer awt_x"])).toBe("awt_x");
    expect(bearerToken("Basic abc")).toBeNull();
    expect(bearerToken("Bearer")).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
  });
});
