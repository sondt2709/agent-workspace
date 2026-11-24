import { FakeClock } from "@aw/core/clock";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLIPBOARD_CLEAR_MS,
  PHRASE_FILE_NAME,
  PhraseBackup,
  defaultPhrasePath,
  phraseFileText,
  writePrivateFile,
  type ClipboardPort,
  type PhraseBackupDeps,
} from "./phrase-backup.ts";

// The public BIP-39 test vector (all-zero entropy), never a real phrase.
const PHRASE = `${"abandon ".repeat(23)}art`;
const IDENTITY = { user: "u7q2example", device: { slug: "macbook-pro", name: "MacBook Pro" } };

/** A clipboard in memory: the tests never touch the system clipboard. */
class FakeClipboard implements ClipboardPort {
  text = "";
  cleared = 0;
  readText() {
    return Promise.resolve(this.text);
  }
  writeText(text: string) {
    this.text = text;
    return Promise.resolve();
  }
  clear() {
    this.text = "";
    this.cleared++;
  }
}

/** Lets the timer callbacks of the fake clock run. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

function setup(more: Partial<PhraseBackupDeps> = {}) {
  const clipboard = new FakeClipboard();
  const clock = new FakeClock("2026-11-24T09:05:30.000Z");
  const deps: PhraseBackupDeps = {
    phrase: () => Promise.resolve(PHRASE),
    identity: () => Promise.resolve(IDENTITY),
    clipboard,
    clock,
    chooseFile: () => Promise.resolve(null),
    home: "/Users/example",
    ...more,
  };
  return { backup: new PhraseBackup(deps), clipboard, clock };
}

describe("PhraseBackup.copy", () => {
  it("puts the 24 words on the clipboard and clears them after 60 s", async () => {
    const { backup, clipboard, clock } = setup();
    expect(await backup.copy()).toEqual({ copied: true, clear_after_ms: 60_000 });
    expect(clipboard.text).toBe(PHRASE);
    clock.advance(CLIPBOARD_CLEAR_MS - 1);
    await settle();
    expect(clipboard.text).toBe(PHRASE);
    clock.advance(1);
    await settle();
    expect(clipboard.text).toBe("");
    expect(clipboard.cleared).toBe(1);
  });

  it("keeps other text that the person copied in the 60 s", async () => {
    const { backup, clipboard, clock } = setup();
    await backup.copy();
    clock.advance(10_000);
    await clipboard.writeText("git status");
    clock.advance(CLIPBOARD_CLEAR_MS);
    await settle();
    expect(clipboard.text).toBe("git status");
    expect(clipboard.cleared).toBe(0);
  });

  it("starts a new 60 s period at a second copy", async () => {
    const { backup, clipboard, clock } = setup();
    await backup.copy();
    clock.advance(50_000);
    await settle();
    await backup.copy();
    clock.advance(10_000);
    await settle();
    expect(clipboard.text).toBe(PHRASE);
    clock.advance(50_000);
    await settle();
    expect(clipboard.text).toBe("");
  });

  it("clears the words one time with clearNow", async () => {
    const { backup, clipboard } = setup();
    expect(await backup.clearNow()).toBe(false);
    expect(backup.holding).toBe(false);
    await backup.copy();
    expect(backup.holding).toBe(true);
    expect(await backup.clearNow()).toBe(true);
    expect(backup.holding).toBe(false);
    expect(clipboard.text).toBe("");
    expect(await backup.clearNow()).toBe(false);
    expect(clipboard.cleared).toBe(1);
  });

  it("clears the words at quit at once, with no clipboard read (a logout must not wait)", async () => {
    const { backup, clipboard } = setup();
    expect(backup.clearAtQuit()).toBe(false);
    await backup.copy();
    const read = vi.spyOn(clipboard, "readText");
    // Synchronous: before-quit cannot wait for a promise without a stop of the quit.
    expect(backup.clearAtQuit()).toBe(true);
    expect(clipboard.text).toBe("");
    expect(read).not.toHaveBeenCalled();
    expect(backup.holding).toBe(false);
    expect(backup.clearAtQuit()).toBe(false);
    expect(clipboard.cleared).toBe(1);
  });

  it("clears at quit also when the person copied other text in the 60 s (fail-closed)", async () => {
    const { backup, clipboard } = setup();
    await backup.copy();
    await clipboard.writeText("git status");
    expect(backup.clearAtQuit()).toBe(true);
    expect(clipboard.text).toBe("");
  });

  it("does not clear again at 60 s after the clear at quit", async () => {
    const { backup, clipboard, clock } = setup();
    await backup.copy();
    backup.clearAtQuit();
    await clipboard.writeText("git status");
    clock.advance(CLIPBOARD_CLEAR_MS);
    await settle();
    expect(clipboard.text).toBe("git status");
    expect(clipboard.cleared).toBe(1);
  });

  it("reports an error of the clear after 60 s and has no unhandled rejection", async () => {
    const onError = vi.fn();
    const { backup, clipboard, clock } = setup({ onError });
    await backup.copy();
    clipboard.clear = () => {
      throw new Error("pasteboard busy");
    };
    clock.advance(CLIPBOARD_CLEAR_MS);
    await settle();
    await settle();
    expect(onError).toHaveBeenCalledWith(new Error("pasteboard busy"));
  });

  it("clears the clipboard when it cannot read it (fail-closed)", async () => {
    const { backup, clipboard, clock } = setup();
    await backup.copy();
    clipboard.readText = () => Promise.reject(new Error("no access"));
    clock.advance(CLIPBOARD_CLEAR_MS);
    await settle();
    expect(clipboard.cleared).toBe(1);
    expect(clipboard.text).toBe("");
  });

  it("writes nothing when awd refuses the phrase", async () => {
    const { backup, clipboard } = setup({
      phrase: () => Promise.reject(new Error("This device has no master key, so it has no phrase")),
    });
    clipboard.text = "old text";
    await expect(backup.copy()).rejects.toThrow("no master key");
    expect(clipboard.text).toBe("old text");
    expect(await backup.clearNow()).toBe(false);
  });
});

describe("PhraseBackup.save", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "aw-phrase-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes a 0600 file with the user, the device, the date and the words", async () => {
    const path = join(dir, PHRASE_FILE_NAME);
    const chooseFile = vi.fn(() => Promise.resolve(path));
    const { backup } = setup({ chooseFile });
    expect(await backup.save()).toEqual({ saved: true, path });
    expect(chooseFile).toHaveBeenCalledWith("/Users/example/agent-workspace-recovery-phrase.txt");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    const text = await readFile(path, "utf8");
    expect(text).toContain("User: u7q2example");
    expect(text).toContain("Device: MacBook Pro (macbook-pro)");
    expect(text).toContain("Date: 2026-11-24 09:05 UTC");
    expect(text).toContain(" 1. abandon\n");
    expect(text).toContain("24. art\n");
    expect(await readdir(dir)).toEqual([PHRASE_FILE_NAME]);
  });

  it("replaces an old 0644 file and gives it mode 0600", async () => {
    const path = join(dir, PHRASE_FILE_NAME);
    await writeFile(path, "old", { mode: 0o644 });
    const { backup } = setup({ chooseFile: () => Promise.resolve(path) });
    await backup.save();
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readFile(path, "utf8")).toContain("24. art");
  });

  it("writes nothing on cancel", async () => {
    const { backup } = setup({ chooseFile: () => Promise.resolve(null) });
    expect(await backup.save()).toEqual({ saved: false, path: null });
    expect(await readdir(dir)).toEqual([]);
  });

  it("shows no dialog when awd refuses the phrase", async () => {
    const chooseFile = vi.fn(() => Promise.resolve(join(dir, PHRASE_FILE_NAME)));
    const { backup } = setup({
      phrase: () => Promise.reject(new Error("refused")),
      chooseFile,
    });
    await expect(backup.save()).rejects.toThrow("refused");
    expect(chooseFile).not.toHaveBeenCalled();
    expect(await readdir(dir)).toEqual([]);
  });
});

describe("writePrivateFile", () => {
  it("removes the temporary file when the rename fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aw-phrase-"));
    try {
      // A folder that is not empty at the target path: the rename of a file over it fails.
      const target = join(dir, "target");
      await mkdir(target);
      await writeFile(join(target, "inside"), "x");
      await expect(writePrivateFile(target, "text")).rejects.toThrow();
      expect(await readdir(dir)).toEqual(["target"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("phraseFileText", () => {
  it("names an unknown user and aligns the numbers", () => {
    const text = phraseFileText({
      phrase: PHRASE,
      user: null,
      device: IDENTITY.device,
      now: Date.parse("2026-01-02T03:04:05Z"),
    });
    expect(text.split("\n").slice(0, 8)).toEqual([
      "Agent Workspace recovery phrase",
      "",
      "These 24 words make your master key again. Anyone with these words can add devices to your workspaces.",
      "Keep this file offline, for example on a USB drive in a safe place. Do not keep it in a synced folder.",
      "",
      "User: unknown",
      "Device: MacBook Pro (macbook-pro)",
      "Date: 2026-01-02 03:04 UTC",
    ]);
    expect(text).toContain("\n 9. abandon\n10. abandon\n");
  });
});

describe("defaultPhrasePath", () => {
  it("proposes the home folder, not Documents, which iCloud can sync", () => {
    const path = defaultPhrasePath({ home: "/Users/example" });
    expect(path).toBe(join("/Users/example", PHRASE_FILE_NAME));
    expect(path).not.toMatch(/Documents|Desktop/);
  });
});
