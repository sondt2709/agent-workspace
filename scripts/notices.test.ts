// Checks THIRD_PARTY_NOTICES (openspec gap-install, install-packaging: third-party notices): the
// APK has an equal copy, and the Syncthing tag is the tag of the engine pins of the computers and
// of Android. A new engine tag must update the notices in the same change.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

/** Each Syncthing tag that the notices name. */
export function noticeTags(text: string): string[] {
  return [
    ...new Set([...text.matchAll(/syncthing\/(?:tree|blob)\/(v\d+\.\d+\.\d+)/g)].map((m) => m[1]!)),
  ]
    .concat([...text.matchAll(/^Syncthing (v\d+\.\d+\.\d+)$/gm)].map((m) => m[1]!))
    .filter((tag, i, all) => all.indexOf(tag) === i);
}

describe("THIRD_PARTY_NOTICES", () => {
  const notices = read("THIRD_PARTY_NOTICES");

  it("has an equal copy in the APK", () => {
    expect(read("android/app/src/main/res/raw/third_party_notices.txt")).toBe(notices);
  });

  it("names the tag of the engine pins of the computers and of Android, and the MPL-2.0 text", () => {
    const computers = (
      JSON.parse(read("plugins/sync-syncthing/engine/engine.json")) as { tag: string }
    ).tag;
    const android = /^SYNCTHING_TAG=(\S+)$/m.exec(
      read("android/engine/engine-version.properties"),
    )?.[1];
    expect(android).toBe(computers);
    expect(noticeTags(notices)).toEqual([computers]);
    expect(notices).toContain("Mozilla Public License Version 2.0");
    expect(notices).toContain(`https://github.com/syncthing/syncthing/tree/${computers}`);
  });

  it("finds an old tag", () => {
    expect(
      noticeTags("Syncthing v2.1.7\nhttps://github.com/syncthing/syncthing/tree/v2.1.6\n"),
    ).toEqual(["v2.1.6", "v2.1.7"]);
  });
});
