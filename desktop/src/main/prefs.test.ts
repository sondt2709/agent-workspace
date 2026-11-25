import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DesktopPrefs } from "./prefs.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "aw-prefs-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("DesktopPrefs", () => {
  it("records a confirmed phrase in a 0600 file that a new instance reads", async () => {
    const path = join(dir, "aw-desktop.json");
    const prefs = new DesktopPrefs(path);
    expect(await prefs.phraseConfirmed("u1")).toBe(false);
    await prefs.confirmPhrase("u1");
    expect(await new DesktopPrefs(path).phraseConfirmed("u1")).toBe(true);
    expect(await new DesktopPrefs(path).phraseConfirmed("u2")).toBe(false);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      phrase_confirmed: ["u1"],
      phrase_shown: [],
    });
  });

  it("records that the app showed the phrase of a user (fix list 0-34)", async () => {
    const path = join(dir, "aw-desktop.json");
    await writeFile(path, `${JSON.stringify({ phrase_confirmed: ["u0"] })}\n`);
    const prefs = new DesktopPrefs(path);
    expect(await prefs.phraseShown("u1")).toBe(false);
    await prefs.markPhraseShown("u1");
    await prefs.markPhraseShown("u1");
    expect(await new DesktopPrefs(path).phraseShown("u1")).toBe(true);
    expect(await new DesktopPrefs(path).phraseConfirmed("u1")).toBe(false);
    expect(await new DesktopPrefs(path).phraseConfirmed("u0")).toBe(true);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      phrase_confirmed: ["u0"],
      phrase_shown: ["u1"],
    });
  });

  it("reads a broken file as empty", async () => {
    const path = join(dir, "aw-desktop.json");
    await writeFile(path, "{not json");
    expect(await new DesktopPrefs(path).phraseConfirmed("u1")).toBe(false);
  });
});

describe("DesktopPrefs appearance (openspec screens-align)", () => {
  it("is system with no key, and keeps a choice for a new instance", async () => {
    const path = join(dir, "aw-desktop.json");
    await writeFile(path, `${JSON.stringify({ phrase_confirmed: ["u0"] })}\n`);
    const prefs = new DesktopPrefs(path);
    expect(await prefs.appearance()).toBe("system");
    await prefs.setAppearance("light");
    expect(await new DesktopPrefs(path).appearance()).toBe("light");
    expect(await new DesktopPrefs(path).phraseConfirmed("u0")).toBe(true);
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ appearance: "light" });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("reads an unknown value and a broken file as system", async () => {
    const path = join(dir, "aw-desktop.json");
    await writeFile(path, `${JSON.stringify({ appearance: "blue", phrase_confirmed: ["u0"] })}\n`);
    expect(await new DesktopPrefs(path).appearance()).toBe("system");
    expect(await new DesktopPrefs(path).phraseConfirmed("u0")).toBe(true);
    await writeFile(path, "{not json");
    expect(await new DesktopPrefs(path).appearance()).toBe("system");
  });
});

describe("DesktopPrefs proposal text size (openspec proposal-and-discussion)", () => {
  it("is 16 px with no key, and keeps a size for a new instance as proposal_text_px", async () => {
    const path = join(dir, "aw-desktop.json");
    await writeFile(path, `${JSON.stringify({ phrase_confirmed: ["u0"], appearance: "dark" })}\n`);
    const prefs = new DesktopPrefs(path);
    expect(await prefs.proposalTextPx()).toBe(16);
    await prefs.setProposalTextPx(20);
    expect(await new DesktopPrefs(path).proposalTextPx()).toBe(20);
    expect(await new DesktopPrefs(path).appearance()).toBe("dark");
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      phrase_confirmed: ["u0"],
      phrase_shown: [],
      appearance: "dark",
      proposal_text_px: 20,
    });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("reads a saved value with the shared rule: limits, steps and bad values", async () => {
    const path = join(dir, "aw-desktop.json");
    for (const [saved, px] of [
      [30, 24],
      [10, 14],
      [17, 16],
      [16.5, 16],
      ["22", 22],
      [true, 16],
      [null, 16],
    ] as const) {
      await writeFile(path, `${JSON.stringify({ proposal_text_px: saved })}\n`);
      expect({ saved, px: await new DesktopPrefs(path).proposalTextPx() }).toEqual({ saved, px });
    }
  });
});
