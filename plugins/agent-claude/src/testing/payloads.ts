// Hook payloads for the fake agent. Each one starts from a payload that Claude Code 2.1.330 sent in
// the verification run on 2026-11-22 (fixtures/hooks-2.1.330.json, with the source in its
// $comment), and the fake agent sets only the values of its own session.
import { readFileSync } from "node:fs";

interface Fixture {
  payloads: Record<string, Record<string, unknown>>;
}

const fixture = JSON.parse(
  readFileSync(new URL("../../fixtures/hooks-2.1.330.json", import.meta.url), "utf8"),
) as Fixture;

/** The captured payloads by key, for example `PreToolUse.Bash`. */
export const capturedPayloads: Readonly<Record<string, Record<string, unknown>>> = fixture.payloads;

/** Event keys that have no capture: the fake agent uses the base fields of the nearest event. */
const NEAREST: Record<string, string> = {
  StopFailure: "Stop",
  "PreToolUse.ExitPlanMode": "PreToolUse.AskUserQuestion",
};

export interface SessionFields {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode: string;
}

/**
 * A payload of the event key with the session fields and the given fields. The captured template
 * keeps the other fields, so the parser sees the same shape as from Claude Code.
 */
export function payload(
  key: string,
  session: SessionFields,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const template =
    capturedPayloads[key] ??
    capturedPayloads[NEAREST[key] ?? ""] ??
    capturedPayloads[key.split(".")[0]!] ??
    {};
  const event = key.split(".")[0]!;
  const base: Record<string, unknown> = { ...structuredClone(template), ...session };
  if (event === "SessionStart" || event === "SessionEnd") delete base.permission_mode;
  if (event === "PostToolUse") delete base.permission_suggestions;
  return { ...base, hook_event_name: event, ...fields };
}
