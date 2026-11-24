// The install helpers (openspec gap-install): the engine install with a local archive, the tmux
// command per OS, and the move of the keys from one keystore to another.
import { FileKeystore, type Keystore } from "@aw/identity";
import { sha256, type EnginePins } from "@aw/sync-syncthing";
import { execa } from "execa";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { tempDir } from "../testing.ts";
import { installEngine } from "./engine.ts";
import { keyOnlyInOsKeystore, moveKeys, MoveKeysError } from "./keys.ts";
import { osReleaseIds, tmuxInstallCommand, tmuxMissingText } from "./tmux.ts";

let dir: string;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

/** A tar.gz in the layout of a Syncthing release: `<name>/syncthing`. */
async function fakeArchive(root: string, name: string): Promise<{ path: string; sum: string }> {
  const folder = join(root, "src", name);
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, "syncthing"), "#!/bin/sh\necho fake engine\n");
  const path = join(root, `${name}.tar.gz`);
  await execa("tar", ["-czf", path, "-C", join(root, "src"), name]);
  return { path, sum: sha256(new Uint8Array(await readFile(path))) };
}

const pinsFor = (archive: string, sum: string): EnginePins => ({
  engine: "syncthing",
  tag: "v2.1.7",
  release_url: "https://example.com/releases",
  signed_sums: "sha256sum.txt.asc",
  release_key_url: "https://example.com/key.txt",
  release_key_fingerprint: "0".repeat(40),
  platforms: { "linux-x64": { archive, sha256: sum } },
});

describe("installEngine", () => {
  it("installs from a local archive with the pinned sha256, and keeps a binary of the same pin", async () => {
    dir = await tempDir("awe-");
    const { path, sum } = await fakeArchive(dir, "syncthing-linux-amd64-v2.1.7");
    const pins = pinsFor("syncthing-linux-amd64-v2.1.7.tar.gz", sum);
    const target = { engine: join(dir, "home", "engine", "syncthing"), engineFromEnv: false };
    const first = await installEngine(target, {
      pins,
      platform: "linux",
      arch: "x64",
      archive: path,
    });
    expect(first).toMatchObject({ binary: target.engine, tag: "v2.1.7", installed: true });
    expect((await stat(target.engine)).mode & 0o111).not.toBe(0);
    const second = await installEngine(target, { pins, platform: "linux", arch: "x64" });
    expect(second.installed).toBe(false);
  });

  it("refuses an archive with another sha256 and writes no binary", async () => {
    dir = await tempDir("awe-");
    const { path } = await fakeArchive(dir, "syncthing-linux-amd64-v2.1.7");
    const pins = pinsFor("syncthing-linux-amd64-v2.1.7.tar.gz", "a".repeat(64));
    const target = { engine: join(dir, "home", "engine", "syncthing"), engineFromEnv: false };
    await expect(
      installEngine(target, { pins, platform: "linux", arch: "x64", archive: path }),
    ).rejects.toThrow(/not the pinned a{64}/);
    await expect(stat(target.engine)).rejects.toThrow(/ENOENT/);
  });

  it("refuses AW_SYNC_ENGINE and a platform with no engine", async () => {
    await expect(installEngine({ engine: "/opt/st", engineFromEnv: true })).rejects.toThrow(
      /Unset AW_SYNC_ENGINE/,
    );
    await expect(
      installEngine({ engine: "/x/syncthing", engineFromEnv: false }, { platform: "win32" }),
    ).rejects.toThrow(/no sync engine for win32/);
  });
});

describe("tmux install command", () => {
  it("names the command of the OS", () => {
    const ubuntu = osReleaseIds('NAME="Ubuntu"\nID=ubuntu\nID_LIKE=debian\n');
    expect(ubuntu).toEqual(["ubuntu", "debian"]);
    expect(tmuxInstallCommand("linux", ubuntu)).toBe("sudo apt install tmux");
    expect(
      tmuxInstallCommand("linux", osReleaseIds('ID="rocky"\nID_LIKE="rhel centos fedora"')),
    ).toBe("sudo dnf install tmux");
    expect(tmuxInstallCommand("darwin")).toBe("brew install tmux");
    expect(tmuxInstallCommand("linux", ["gentoo"])).toBeNull();
    expect(tmuxMissingText(null)).toContain("package manager");
    expect(tmuxMissingText("brew install tmux")).toBe(
      "tmux is missing: AW sessions need it. Install it: brew install tmux",
    );
  });
});

describe("keys of a headless Mac", () => {
  it("finds a key that is only in the OS keystore", async () => {
    dir = await tempDir("awk-");
    expect(await keyOnlyInOsKeystore(dir)).toBe(false);
    await writeFile(join(dir, "config.yaml"), "device: {}\n");
    expect(await keyOnlyInOsKeystore(dir)).toBe(true);
    await new FileKeystore(join(dir, "keys")).set("device", "{}");
    expect(await keyOnlyInOsKeystore(dir)).toBe(false);
  });

  it("moves the device key and the phrase, reads them back, then deletes them", async () => {
    dir = await tempDir("awk-");
    const from: Keystore = new FileKeystore(join(dir, "os"));
    const to = new FileKeystore(join(dir, "keys"));
    await from.set("device", '{"k":1}');
    await from.set("master-phrase", "word ".repeat(24).trim());
    const result = await moveKeys(dir, { from, to });
    expect(result.moved).toEqual(["device", "master-phrase"]);
    expect(await to.get("device")).toBe('{"k":1}');
    expect(await from.get("device")).toBeNull();
    expect(await from.get("master-phrase")).toBeNull();
    expect((await moveKeys(dir, { from, to })).moved).toEqual([]);
  });

  it("moves the phrase when the device key is already in the file keystore (gap-install low 7)", async () => {
    dir = await tempDir("awk-");
    const from = new FileKeystore(join(dir, "os"));
    const to = new FileKeystore(join(dir, "keys"));
    await to.set("device", '{"k":1}');
    await from.set("master-phrase", "word ".repeat(24).trim());
    expect((await moveKeys(dir, { from, to })).moved).toEqual(["master-phrase"]);
    expect(await to.get("master-phrase")).toBe("word ".repeat(24).trim());
    expect(await from.get("master-phrase")).toBeNull();
  });

  it("refuses 2 different keys and an empty Keychain, and moves nothing", async () => {
    dir = await tempDir("awk-");
    const from = new FileKeystore(join(dir, "os"));
    const to = new FileKeystore(join(dir, "keys"));
    await expect(moveKeys(dir, { from, to })).rejects.toThrow(MoveKeysError);
    await from.set("device", "a");
    await to.set("device", "b");
    await expect(moveKeys(dir, { from, to })).rejects.toThrow(/another value/);
    expect(await from.get("device")).toBe("a");
  });
});
