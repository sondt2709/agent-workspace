// The rules of the Inbox and the project filter that both apps use (openspec inbox-mattermost and
// nav-tasks-needs-you). Kotlin: InboxCards.kt and ProjectFilter.kt in android/control, tested with
// the same fixtures: contracts/fixtures/inbox/cards.json and contracts/fixtures/filters/projects.json.

/** The value of "No project" in a project filter. */
export const NO_PROJECT = "none";

/**
 * The items of the selected projects. An empty selection keeps all items. `none` selects the items
 * with no project.
 */
export function filterByProjects<T>(
  items: readonly T[],
  selected: readonly string[],
  projectOf: (item: T) => string | null,
): T[] {
  if (selected.length === 0) return [...items];
  const set = new Set(selected);
  return items.filter((item) => set.has(projectOf(item) ?? NO_PROJECT));
}

/** The text of the filter chip: "Project", 1 or 2 names, or "<n> projects". */
export function projectFilterLabel(
  selected: readonly string[],
  nameOf: (slug: string) => string,
): string {
  if (selected.length === 0) return "Project";
  const names = selected.map((slug) => (slug === NO_PROJECT ? "No project" : nameOf(slug)));
  return names.length <= 2 ? names.join(", ") : `${names.length} projects`;
}

/** The selection of the route parameter `projects=a,b`: known slugs (and `none` when allowed). */
export function parseProjectFilter(
  value: string | null,
  known: readonly string[],
  allowNone: boolean,
): string[] {
  if (value === null || value === "") return [];
  const allowed = new Set([...known, ...(allowNone ? [NO_PROJECT] : [])]);
  return [...new Set(value.split(","))].filter((slug) => allowed.has(slug));
}

/** The rows of a project filter list for a search text: "No project" first, then by name. */
export function projectFilterRows(
  projects: readonly { slug: string; name: string }[],
  search: string,
  allowNone: boolean,
): { slug: string; name: string }[] {
  const text = search.trim().toLowerCase();
  const rows = [
    ...(allowNone ? [{ slug: NO_PROJECT, name: "No project" }] : []),
    // By the lower-case name, then by the name, by UTF-16 code unit: the same order as the phone
    // (contracts/fixtures/filters/projects.json), not the order of a locale.
    ...[...projects].sort(
      (a, b) =>
        byCodeUnit(a.name.toLowerCase(), b.name.toLowerCase()) || byCodeUnit(a.name, b.name),
    ),
  ];
  return text === "" ? rows : rows.filter((row) => row.name.toLowerCase().includes(text));
}

export type CardCategory = "action" | "question" | "info";
export type CardUrgency = "high" | "normal" | "low";

/** The fields of a card that the list rules read (a part of `CardView` of `@aw/core`). */
export interface CardRowInput {
  card: string;
  category: CardCategory;
  urgency: CardUrgency;
  project: string | null;
  read: boolean;
  done: boolean;
  last_message_at: string;
}

export interface CardFilter {
  category: CardCategory | "all";
  projects: string[];
  unread: boolean;
  /** Show the done cards too. */
  done: boolean;
  sort: "urgency" | "newest";
}

export const DEFAULT_CARD_FILTER: CardFilter = {
  category: "all",
  projects: [],
  unread: false,
  done: false,
  sort: "urgency",
};

const URGENCY_RANK: Record<CardUrgency, number> = { high: 0, normal: 1, low: 2 };

function newest(a: CardRowInput, b: CardRowInput): number {
  if (a.last_message_at !== b.last_message_at)
    return a.last_message_at < b.last_message_at ? 1 : -1;
  return a.card < b.card ? -1 : a.card > b.card ? 1 : 0;
}

/** The cards of the list, in the order of the sort: urgency (high first), then the newest. */
export function cardRows<T extends CardRowInput>(cards: readonly T[], filter: CardFilter): T[] {
  let rows = cards.filter((c) => filter.done || !c.done);
  rows = filterByProjects(rows, filter.projects, (c) => c.project);
  if (filter.category !== "all") rows = rows.filter((c) => c.category === filter.category);
  if (filter.unread) rows = rows.filter((c) => !c.read);
  return [...rows].sort((a, b) =>
    filter.sort === "urgency"
      ? URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency] || newest(a, b)
      : newest(a, b),
  );
}

/** The counts of the open cards of each category and the unread open cards. */
export function cardCounts(cards: readonly CardRowInput[]): Record<CardCategory, number> & {
  unread: number;
} {
  const open = cards.filter((c) => !c.done);
  return {
    action: open.filter((c) => c.category === "action").length,
    question: open.filter((c) => c.category === "question").length,
    info: open.filter((c) => c.category === "info").length,
    unread: open.filter((c) => !c.read).length,
  };
}

/** The longest message text that a batch gives the agent (design 6). */
export const FENCE_TEXT_MAX = 8000;

/** A control character (but a tab or a line break) or an invisible format character. */
function hidden(code: number): boolean {
  if (code === 0x09 || code === 0x0a) return false;
  return (
    code < 0x20 ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x2064) ||
    code === 0xfeff
  );
}

/**
 * A message text for a batch in a fence (design 6): no run of 3 backticks, no control
 * character but a line break or a tab, no invisible format character, at most 8,000 characters.
 */
export function fenceText(text: string): string {
  const clean = [...text.replace(/\r\n?/g, "\n")]
    .filter((char) => !hidden(char.codePointAt(0)!))
    .join("")
    .replace(/`{3,}/g, (run) => "'".repeat(run.length));
  return clean.length > FENCE_TEXT_MAX ? `${clean.slice(0, FENCE_TEXT_MAX)} [cut]` : clean;
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
