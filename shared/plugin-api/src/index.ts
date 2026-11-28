// @aw/plugin-api: the interfaces that each plugin implements (docs/architecture.md 6,
// decisions/2026-11-22-modules.md). Types only: a plugin depends on this package, never on another plugin.
export type * from "./agent-runtime.ts";
export type * from "./session-host.ts";
export const packageName = "@aw/plugin-api";

export type * from "./knowledge.ts";
export type * from "./source.ts";
export type * from "./sync.ts";
