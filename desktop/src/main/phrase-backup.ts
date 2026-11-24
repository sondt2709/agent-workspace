// Copy and save of the recovery phrase (openspec keys-backup, review F-3). Only the main process
// does both: it reads the phrase from awd itself, so the renderer never sends the words. The copy
// stays on the clipboard for at most 60 s; the file has mode 0600.
import type { Clock } from "@aw/core/clock";
import { createHash, randomBytes } from "node:crypto";
import { open, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/** The time after the last copy when main clears the clipboard that still holds the words. */
export const CLIPBOARD_CLEAR_MS = 60_000;
/** The default name of the saved file (review 5.5 decision 2). */
export const PHRASE_FILE_NAME = "agent-workspace-recovery-phrase.txt";

/**
 * The path that the save dialog proposes: the home folder. Not Documents or Desktop: iCloud Drive
 * syncs them when "Desktop & Documents Folders" is on, and the file must stay out of synced folders.
 */
export function defaultPhrasePath(paths: { home: string }): string {
  return join(paths.home, PHRASE_FILE_NAME);
}

/** The system clipboard (the async Electron `clipboard` in index.ts, a fake in tests). */
export interface ClipboardPort {
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
  clear(): void;
}

export interface PhraseIdentity {
  user: string | null;
  device: { slug: string; name: string };
}

export interface PhraseBackupDeps {
  /** The phrase from awd (`GET /v1/identity/phrase`); it throws on a device with no master key. */
  phrase(): Promise<string>;
  identity(): Promise<PhraseIdentity>;
  clipboard: ClipboardPort;
  clock: Clock;
  /** The native save dialog at `defaultPath`: the chosen absolute path, or null on cancel. */
  chooseFile(defaultPath: string): Promise<string | null>;
  /** The home folder of the user (`app.getPath("home")`). */
  home: string;
  /** An error of the clear 60 s after a copy (the log of main). */
  onError?: (error: unknown) => void;
  /** Replaces `path` with `text` and mode 0600; default `writePrivateFile`. */
  writeFile?: (path: string, text: string) => Promise<void>;
}

export interface CopyPhraseResult {
  copied: true;
  clear_after_ms: number;
}

export interface SavePhraseResult {
  saved: boolean;
  path: string | null;
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** The words of the phrase, split on white space (`copy` joins them with single spaces). */
export function phraseWords(phrase: string): string[] {
  return phrase.split(/\s+/).filter(Boolean);
}

/** `2026-11-24 10:20 UTC` */
function utcText(ms: number): string {
  const iso = new Date(ms).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/** The text of the saved file: the warning, the user, the device, the date, the numbered words. */
export function phraseFileText(input: {
  phrase: string;
  user: string | null;
  device: { slug: string; name: string };
  now: number;
}): string {
  const words = phraseWords(input.phrase);
  const width = String(words.length).length;
  const lines = [
    "Agent Workspace recovery phrase",
    "",
    "These 24 words make your master key again. Anyone with these words can add devices to your workspaces.",
    "Keep this file offline, for example on a USB drive in a safe place. Do not keep it in a synced folder.",
    "",
    `User: ${input.user ?? "unknown"}`,
    `Device: ${input.device.name} (${input.device.slug})`,
    `Date: ${utcText(input.now)}`,
    "",
    ...words.map((word, i) => `${String(i + 1).padStart(width, " ")}. ${word}`),
    "",
  ];
  return lines.join("\n");
}

/**
 * Writes `text` to `path` with mode 0600: a new temporary file in the same folder (flag `wx`),
 * then a rename over `path`. A file that was at `path` is replaced, so its old mode does not stay.
 */
export async function writePrivateFile(path: string, text: string): Promise<void> {
  const temp = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString("hex")}.tmp`);
  const handle = await open(temp, "wx", 0o600);
  try {
    try {
      await handle.writeFile(text, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

export class PhraseBackup {
  readonly #deps: PhraseBackupDeps;
  /** The sha256 of the text that the last copy put on the clipboard, until the clear. */
  #held: string | null = null;
  #copies = 0;

  constructor(deps: PhraseBackupDeps) {
    this.#deps = deps;
  }

  /** True from a copy until the clear. */
  get holding(): boolean {
    return this.#held !== null;
  }

  /** Puts the words on the clipboard and clears them after 60 s when the clipboard still has them. */
  async copy(): Promise<CopyPhraseResult> {
    const text = phraseWords(await this.#deps.phrase()).join(" ");
    await this.#deps.clipboard.writeText(text);
    this.#held = sha256(text);
    const copy = ++this.#copies;
    void this.#deps.clock
      .sleep(CLIPBOARD_CLEAR_MS)
      .then(async () => {
        if (copy === this.#copies) await this.clearNow();
      })
      .catch((error: unknown) => this.#deps.onError?.(error));
    return { copied: true, clear_after_ms: CLIPBOARD_CLEAR_MS };
  }

  /**
   * Clears the clipboard when it still holds the copied words (the timer).
   * Other text that the person copied after the words stays. When main cannot read the clipboard,
   * it clears it (fail-closed). True when it cleared.
   */
  async clearNow(): Promise<boolean> {
    const held = this.#held;
    if (held === null) return false;
    this.#held = null;
    let current: string | null;
    try {
      current = await this.#deps.clipboard.readText();
    } catch {
      current = null;
    }
    if (current !== null && sha256(current) !== held) return false;
    this.#deps.clipboard.clear();
    return true;
  }

  /**
   * The clear at quit (`before-quit`): synchronous and with no check of the text, so the quit never
   * waits. A quit that waits for the async clipboard read must stop and start again, and a stopped
   * quit can cancel a macOS logout or shutdown. Fail-closed: newer text of the person that is on
   * the clipboard less than 60 s after the copy goes too. True when it cleared.
   */
  clearAtQuit(): boolean {
    if (this.#held === null) return false;
    this.#held = null;
    this.#deps.clipboard.clear();
    return true;
  }

  /** Asks for a path in the native dialog and writes the phrase file with mode 0600. */
  async save(): Promise<SavePhraseResult> {
    // Read the phrase first: a device with no master key gets the error before a dialog shows.
    const phrase = await this.#deps.phrase();
    const identity = await this.#deps.identity();
    const path = await this.#deps.chooseFile(defaultPhrasePath({ home: this.#deps.home }));
    if (path === null) return { saved: false, path: null };
    const text = phraseFileText({
      phrase,
      user: identity.user,
      device: identity.device,
      now: this.#deps.clock.now(),
    });
    await (this.#deps.writeFile ?? writePrivateFile)(path, text);
    return { saved: true, path };
  }
}
