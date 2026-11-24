// The preferences of the desktop app that are not awd data: the users whose recovery phrase the
// person confirmed (design decision 6 of add-desktop-devices-knowledge), the users whose phrase
// the app showed by itself one time (owner decision Q10, fix list 0-34), and the appearance
// (System, Light, Dark; openspec screens-align). One JSON file in the
// Electron user data folder, mode 0600, written with a temporary file and a rename.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import type { Appearance } from "../shared/channels.ts";

export const APPEARANCES = ["system", "light", "dark"] as const satisfies readonly Appearance[];

const prefsFile = z.looseObject({
  phrase_confirmed: z.array(z.string()).default([]),
  phrase_shown: z.array(z.string()).default([]),
  // An unknown value counts as "system"; a file with no key keeps no key.
  appearance: z.enum(APPEARANCES).optional().catch(undefined),
});
type PrefsFile = z.infer<typeof prefsFile>;

export class DesktopPrefs {
  readonly path: string;
  #data: PrefsFile | null = null;

  constructor(path: string) {
    this.path = path;
  }

  async #load(): Promise<PrefsFile> {
    if (this.#data) return this.#data;
    let raw: unknown = {};
    try {
      raw = JSON.parse(await readFile(this.path, "utf8"));
    } catch {
      // A missing or broken file is an empty one: the worst case shows the phrase screen again.
    }
    const parsed = prefsFile.safeParse(raw);
    this.#data = parsed.success ? parsed.data : { phrase_confirmed: [], phrase_shown: [] };
    return this.#data;
  }

  async #save(data: PrefsFile): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    await rename(tmp, this.path);
  }

  async phraseConfirmed(user: string): Promise<boolean> {
    return (await this.#load()).phrase_confirmed.includes(user);
  }

  /** True when the app showed the phrase of `user` by itself before (the first start). */
  async phraseShown(user: string): Promise<boolean> {
    return (await this.#load()).phrase_shown.includes(user);
  }

  async confirmPhrase(user: string): Promise<void> {
    const data = await this.#load();
    if (data.phrase_confirmed.includes(user)) return;
    const next = { ...data, phrase_confirmed: [...data.phrase_confirmed, user] };
    await this.#save(next);
    this.#data = next;
  }

  async markPhraseShown(user: string): Promise<void> {
    const data = await this.#load();
    if (data.phrase_shown.includes(user)) return;
    const next = { ...data, phrase_shown: [...data.phrase_shown, user] };
    await this.#save(next);
    this.#data = next;
  }

  /** The appearance of the app: "system" when the file has none. */
  async appearance(): Promise<Appearance> {
    return (await this.#load()).appearance ?? "system";
  }

  async setAppearance(appearance: Appearance): Promise<void> {
    const data = await this.#load();
    if ((data.appearance ?? "system") === appearance) return;
    const next = { ...data, appearance };
    await this.#save(next);
    this.#data = next;
  }
}
