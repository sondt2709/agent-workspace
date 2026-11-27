// The Inbox and project filter rules against the shared fixtures (the phone runs the same cases).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  cardCounts,
  cardRows,
  fenceText,
  filterByProjects,
  parseProjectFilter,
  projectFilterLabel,
  projectFilterRows,
  type CardFilter,
  type CardRowInput,
} from "./inbox.ts";

interface ProjectsFixture {
  names: Record<string, string>;
  items: { id: string; project: string | null }[];
  filter: { name: string; selected: string[]; ids: string[]; label: string }[];
  parse: { name: string; value: string; allow_none: boolean; selected: string[] }[];
  rows: { name: string; search: string; allow_none: boolean; slugs: string[] }[];
}

interface CardsFixture {
  cards: CardRowInput[];
  counts: Record<string, number>;
  rows: { name: string; filter: CardFilter; cards: string[] }[];
  fence: { name: string; text: string; result: string }[];
}

function fixture<T>(path: string): T {
  const url = new URL(`../../../contracts/fixtures/${path}`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as T;
}

describe("project filter", () => {
  const f = fixture<ProjectsFixture>("filters/projects.json");
  const items = f.items;
  const names = f.names;

  it.each(f.filter)("$name", (c) => {
    expect(filterByProjects(items, c.selected, (i) => i.project).map((i) => i.id)).toEqual(c.ids);
    expect(projectFilterLabel(c.selected, (slug) => names[slug] ?? slug)).toBe(c.label);
  });

  it.each(f.parse)("parse: $name", (c) => {
    expect(parseProjectFilter(c.value, Object.keys(names), c.allow_none)).toEqual(c.selected);
  });

  it.each(f.rows)("rows: $name", (c) => {
    const projects = Object.entries(names).map(([slug, name]) => ({ slug, name }));
    expect(projectFilterRows(projects, c.search, c.allow_none).map((r) => r.slug)).toEqual(c.slugs);
  });
});

describe("inbox cards", () => {
  const f = fixture<CardsFixture>("inbox/cards.json");
  const cards = f.cards;

  it("counts the open cards", () => {
    expect(cardCounts(cards)).toEqual(f.counts);
  });

  it.each(f.rows)("$name", (c) => {
    expect(cardRows(cards, c.filter).map((card) => card.card)).toEqual(c.cards);
  });

  it.each(f.fence)("fence: $name", (c) => {
    expect(fenceText(c.text)).toBe(c.result);
  });
});
