// The approval rules of an agent change (docs/architecture.md 4.8.3, prd KB-11, design decision 9).
import type { ApprovalReason } from "@aw/plugin-api";
import { isRule, type PathParts } from "./paths.ts";

export interface ApprovalInput {
  parts: PathParts;
  /** The author of the change, for example `claude@ubuntu-01` or `human@pixel-9`. */
  author: string;
  /** True when the current file has `locked: true` in its front matter. */
  locked: boolean;
  /**
   * True when the current file or the new content has `apply: always`: such a file goes under
   * "Read now" of each session of its scope, the same as a rule (fix list 0-0b).
   */
  always?: boolean | undefined;
  /** The person whose message brought the knowledge (P2 signals), else null. */
  from_person?: string | null | undefined;
}

/** True for a human (`human@…`) or AW itself (`aw@…`): their changes need no approval. */
export function isHumanOrAw(actor: string): boolean {
  return actor.startsWith("human@") || actor.startsWith("aw@");
}

/** The reasons why an agent change waits for approval. Empty: apply it at once. */
export function approvalReasons(input: ApprovalInput): ApprovalReason[] {
  if (isHumanOrAw(input.author)) return [];
  const reasons: ApprovalReason[] = [];
  if (isRule(input.parts) || input.always === true) reasons.push("rule");
  if (input.locked) reasons.push("locked");
  if (input.parts.scope === "shared") reasons.push("shared");
  if (input.from_person) reasons.push("other_person");
  return reasons;
}
