// The tmux check of `aw service install` and `aw doctor` (openspec gap-install, awd-service:
// service units): the install command of the OS when tmux is missing.
import { readFile } from "node:fs/promises";

/** The keys `ID` and `ID_LIKE` of an os-release text, in lower case. */
export function osReleaseIds(text: string): string[] {
  const ids: string[] = [];
  for (const line of text.split("\n")) {
    const match = /^(ID|ID_LIKE)=(.*)$/.exec(line.trim());
    if (!match) continue;
    const value = match[2]!.replace(/^["']|["']$/g, "").toLowerCase();
    ids.push(...value.split(/\s+/).filter((id) => id.length > 0));
  }
  return ids;
}

const LINUX_COMMANDS: [string[], string][] = [
  [["debian", "ubuntu"], "sudo apt install tmux"],
  [["fedora", "rhel", "centos"], "sudo dnf install tmux"],
  [["arch"], "sudo pacman -S tmux"],
  [["suse", "opensuse"], "sudo zypper install tmux"],
  [["alpine"], "sudo apk add tmux"],
];

/** The install command of tmux for a platform and the os-release ids, or null when not known. */
export function tmuxInstallCommand(platform: NodeJS.Platform, ids: string[] = []): string | null {
  if (platform === "darwin") return "brew install tmux";
  if (platform !== "linux") return null;
  for (const [names, command] of LINUX_COMMANDS) {
    if (ids.some((id) => names.includes(id))) return command;
  }
  return null;
}

/** The text for a missing tmux, with the command of this OS. */
export function tmuxMissingText(command: string | null): string {
  return command
    ? `tmux is missing: AW sessions need it. Install it: ${command}`
    : "tmux is missing: AW sessions need it. Install tmux with the package manager of this system.";
}

/** The install command of tmux on this computer (reads /etc/os-release on Linux). */
export async function localTmuxInstallCommand(
  platform: NodeJS.Platform = process.platform,
  osRelease = "/etc/os-release",
): Promise<string | null> {
  if (platform !== "linux") return tmuxInstallCommand(platform);
  const text = await readFile(osRelease, "utf8").catch(() => "");
  return tmuxInstallCommand(platform, osReleaseIds(text));
}
