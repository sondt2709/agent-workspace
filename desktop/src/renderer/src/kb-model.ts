// The logic of the knowledge and files screens that does not need React
// (add-desktop-devices-knowledge).
import type { HistoryEntry, KnowledgeFile, TaskFileEntry } from "../../shared/channels.ts";

export type KbGroup = "Rules" | "Knowledge" | "Learned";
export const KB_GROUPS: KbGroup[] = ["Rules", "Knowledge", "Learned"];

export function kbGroup(file: KnowledgeFile): KbGroup {
  if (file.rule) return "Rules";
  if (file.learned) return "Learned";
  return "Knowledge";
}

/** The files of each group, by path. */
export function groupFiles(files: KnowledgeFile[]): { group: KbGroup; files: KnowledgeFile[] }[] {
  return KB_GROUPS.map((group) => ({
    group,
    files: files.filter((f) => kbGroup(f) === group).sort((a, b) => a.path.localeCompare(b.path)),
  })).filter((g) => g.files.length > 0);
}

/** The file name of a knowledge path. */
export function fileName(path: string): string {
  return path.split("/").at(-1) ?? path;
}

/** The Markdown body of a file without its front matter block. */
export function bodyOf(content: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(content);
  return match ? content.slice(match[0].length) : content;
}

/** "Learned by claude@ubuntu-01 on AW-7": the label of the change that added a learned file. */
export function learnedLabel(history: HistoryEntry[] | undefined): string | null {
  const learned = (history ?? []).find((h) => h.kind === "learned");
  return learned?.label ?? null;
}

export const REASON_TEXT: Record<string, string> = {
  rule: "a rule",
  locked: "a locked file",
  shared: "shared knowledge",
  other_person: "a file of another person",
};

/** Why a suggestion waits: "It changes a rule and shared knowledge." */
export function reasonsText(reasons: string[]): string {
  const parts = reasons.map((r) => REASON_TEXT[r] ?? r.replaceAll("_", " "));
  if (parts.length === 0) return "It waits for approval.";
  const list =
    parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return `It changes ${list}.`;
}

/** The digest line: "1 learned · 2 changes · 1 waits for approval". */
export function digestLine(counts: { learned: number; changes: number; pending: number }): string {
  const parts: string[] = [];
  if (counts.learned > 0) parts.push(`${counts.learned} learned`);
  if (counts.changes > 0)
    parts.push(`${counts.changes} ${counts.changes === 1 ? "change" : "changes"}`);
  if (counts.pending > 0) {
    parts.push(`${counts.pending} ${counts.pending === 1 ? "waits" : "wait"} for approval`);
  }
  return parts.join(" · ");
}

/** The depth of an entry in the folder of a task (0 for `task.yaml`). */
export function depthOf(entry: TaskFileEntry): number {
  return entry.name.split("/").length - 1;
}

/** "12 KB", "1.2 MB". */
export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
