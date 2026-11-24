// A plain term search over the knowledge files (design decision 15). P3 adds a vector index.
import type { SearchHit } from "@aw/plugin-api";

const SNIPPET_LIMIT = 160;

export function terms(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))];
}

function count(text: string, term: string): number {
  let n = 0;
  for (let at = text.indexOf(term); at >= 0; at = text.indexOf(term, at + term.length)) n += 1;
  return n;
}

/** Each hit has each term in its path or text. The score is the count of the terms. */
export function searchTexts(
  files: { path: string; text: string }[],
  query: string,
  limit: number,
): SearchHit[] {
  const words = terms(query);
  if (words.length === 0) return [];
  const hits: SearchHit[] = [];
  for (const file of files) {
    const path = file.path.toLowerCase();
    const text = file.text.toLowerCase();
    if (!words.every((w) => path.includes(w) || text.includes(w))) continue;
    const score = words.reduce((sum, w) => sum + count(path, w) + count(text, w), 0);
    const lines = file.text.split("\n");
    const index = lines.findIndex((line) => words.some((w) => line.toLowerCase().includes(w)));
    const snippet = index >= 0 ? lines[index]!.trim() : "";
    hits.push({
      path: file.path,
      score,
      line: index >= 0 ? index + 1 : 0,
      snippet: snippet.length > SNIPPET_LIMIT ? `${snippet.slice(0, SNIPPET_LIMIT - 1)}…` : snippet,
    });
  }
  return hits
    .sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : 1))
    .slice(0, Math.max(0, limit));
}
