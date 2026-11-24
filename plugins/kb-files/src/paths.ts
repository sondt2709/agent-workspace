// Knowledge paths: relative to the `knowledge/` folder, `shared/…` or `projects/<project>/…`
// (docs/architecture.md 4.8.1, design decision 1).
import type { KnowledgeScope } from "@aw/plugin-api";

const PROJECT = "[a-z0-9]+(?:-[a-z0-9]+)*";
const SHARED = /^shared\/(?<rest>.+)$/;
const PROJECTS = new RegExp(`^projects/(?<project>${PROJECT})/(?<rest>.+)$`);

export interface PathParts {
  path: string;
  scope: "shared" | "project";
  project: string | null;
  /** The path inside the scope, for example `rules/testing.md`. */
  rest: string;
}

/**
 * Parses a knowledge path. Returns null for a path outside the 2 scopes, a path with `..`, `.` or
 * an empty part, or a hidden part (a name that starts with `.`, for example `.DS_Store` or a
 * Syncthing temp file): those are not knowledge files.
 */
export function parseKnowledgePath(path: string): PathParts | null {
  if (path.includes("\\") || path.startsWith("/")) return null;
  const parts = path.split("/");
  if (parts.some((part) => part === "" || part === ".." || part.startsWith("."))) return null;
  if (parts.some((part) => part.endsWith(".aw-tmp") || part.includes(".sync-conflict-")))
    return null;
  if (parts.some((part) => part.startsWith("~syncthing~"))) return null;
  const shared = SHARED.exec(path);
  if (shared) return { path, scope: "shared", project: null, rest: shared.groups!.rest! };
  const project = PROJECTS.exec(path);
  if (project) {
    return {
      path,
      scope: "project",
      project: project.groups!.project!,
      rest: project.groups!.rest!,
    };
  }
  return null;
}

/**
 * The first folder of the path inside its scope, in one case form, or null for a file at the top of
 * the scope. The file systems of macOS and Windows ignore case, so `Rules/` there is the folder
 * `rules/`: each check of a scope folder compares this form (fix list 0-0a).
 */
function scopeFolder(parts: PathParts): string | null {
  const slash = parts.rest.indexOf("/");
  if (slash < 0) return null;
  return parts.rest.slice(0, slash).normalize("NFKC").toLowerCase();
}

/** True for a file in `rules/` of its scope (`shared/rules/…`, `projects/<p>/rules/…`), in any case. */
export function isRule(parts: PathParts): boolean {
  return scopeFolder(parts) === "rules";
}

/** True for a file in `learned/` of its scope, in any case. */
export function isLearned(parts: PathParts): boolean {
  return scopeFolder(parts) === "learned";
}

export function inScope(parts: PathParts, scope: KnowledgeScope): boolean {
  switch (scope.kind) {
    case "all":
      return true;
    case "shared":
      return parts.scope === "shared";
    case "project":
      return parts.scope === "project" && parts.project === scope.project;
  }
}

/** The path of a knowledge file relative to the workspace root, for the files layer. */
export function workspacePath(path: string): string {
  return `knowledge/${path}`;
}

/** A file name part from a title: lower case, `-` between words, at most 60 characters. */
export function slugOf(title: string): string {
  const slug = title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug === "" ? "item" : slug;
}
