// The text of a gate with decisions (openspec gate-full-context, design decision 4). awd appends the
// decisions of `gate.opened` to the gate text as a Markdown block, so the CLI and the agents read
// them. A screen that shows `data.decisions` itself cuts that block. Kotlin: GateTexts.kt.

/** The start of the decision block that awd appends (`gateText` in daemon/src/loop/agent.ts). */
export const DECISIONS_HEADING = "\n\n## Decisions\n";

/** One decision of a gate, with its recommended option. */
export interface GateDecision {
  question: string;
  options: string[];
  recommended: string;
}

/** The decisions of `gate.opened` data, or [] for data of another form. */
export function gateDecisions(data: Record<string, unknown> | undefined): GateDecision[] {
  const raw = data?.decisions;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((d: unknown) => {
    const item = d as Partial<GateDecision> | null;
    if (
      typeof item?.question !== "string" ||
      typeof item.recommended !== "string" ||
      !Array.isArray(item.options) ||
      !item.options.every((o) => typeof o === "string")
    ) {
      return [];
    }
    return [{ question: item.question, options: item.options, recommended: item.recommended }];
  });
}

/** The gate text with no decision block, when the gate has decisions to show; else the text. */
export function gateBody(text: string, decisions: readonly GateDecision[]): string {
  if (decisions.length === 0) return text;
  const at = text.lastIndexOf(DECISIONS_HEADING);
  return at < 0 ? text : text.slice(0, at);
}

// ---- Question details, context and questions (openspec gate-context). Kotlin: GateTexts.kt. ----

/** One option of a gate question (`gate.opened` `data.questions[].options[]`). */
export interface GateQuestionOption {
  label: string;
  description: string;
}

/** One question of a gate, with its header, its multi-select value and its options. */
export interface GateQuestion {
  question: string;
  header: string | null;
  multi_select: boolean;
  options: GateQuestionOption[];
}

/** The questions of `gate.opened` data; a question of another form is left out. */
export function gateQuestions(data: Record<string, unknown> | undefined): GateQuestion[] {
  const raw = data?.questions;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((q: unknown) => {
    const item = q as Partial<Record<keyof GateQuestion, unknown>> | null;
    if (typeof item?.question !== "string" || !Array.isArray(item.options)) return [];
    const options = item.options.flatMap((o: unknown) => {
      const option = o as { label?: unknown; description?: unknown } | null;
      if (typeof option?.label !== "string") return [];
      const description = typeof option.description === "string" ? option.description : "";
      return [{ label: option.label, description }];
    });
    return [
      {
        question: item.question,
        header: typeof item.header === "string" ? item.header : null,
        multi_select: item.multi_select === true,
        options,
      },
    ];
  });
}

/**
 * How a card shows the questions: "none" (no questions), "buttons" (one single-choice question:
 * one button per option, with its description), "list" (several questions or a multi-select one:
 * each question with its choices and "Send answers").
 */
export function questionMode(questions: readonly GateQuestion[]): "none" | "buttons" | "list" {
  if (questions.length === 0) return "none";
  if (questions.length === 1 && !questions[0]!.multi_select) return "buttons";
  return "list";
}

/**
 * The index of the recommended option of a question gate: the first label that contains
 * "(Recommended)" in any case (the AskUserQuestion rule of Claude Code), else 0; -1 with no
 * options. The card shows it as the filled button. Kotlin: `GateTexts.recommended`. Cases:
 * `contracts/fixtures/gates/recommended.json`.
 */
export function recommendedOption(options: readonly string[]): number {
  if (options.length === 0) return -1;
  const at = options.findIndex((label) => label.toLowerCase().includes("(recommended)"));
  return at < 0 ? 0 : at;
}

/** The text of a question with no pick (the Claude Code AskUserQuestion result, 2.1.331). */
export const NO_PICK = "(no option selected)";

/**
 * The answer of a question list: `"<question>"="<labels>"` for each question, joined by ", ". The
 * labels of a multi-select pick are joined by ", ". The format of the AskUserQuestion tool result
 * of Claude Code 2.1.331, so the agent reads it as its own answer. `picks[i]` are the labels picked
 * for question i, in the order of its options.
 */
export function questionAnswer(
  questions: readonly GateQuestion[],
  picks: readonly (readonly string[])[],
): string {
  return questions
    .map((q, i) => {
      const chosen = q.options.map((o) => o.label).filter((l) => (picks[i] ?? []).includes(l));
      return chosen.length === 0
        ? `"${q.question}"=${NO_PICK}`
        : `"${q.question}"="${chosen.join(", ")}"`;
    })
    .join(", ");
}

/**
 * The text that the Claude plugin writes for the questions of AskUserQuestion (`toolGate`): each
 * question with `Options: a | b`, joined by an empty line. A card that shows the questions does not
 * show this text again.
 */
export function questionsListing(questions: readonly GateQuestion[]): string {
  return questions
    .map((q) =>
      q.options.length > 0
        ? `${q.question}\nOptions: ${q.options.map((o) => o.label).join(" | ")}`
        : q.question,
    )
    .join("\n\n");
}

/**
 * True when the gate text says more than its title (and more than the listing of its questions):
 * the card shows it as the body.
 */
export function gateHasBody(
  title: string,
  text: string,
  questions: readonly GateQuestion[] = [],
): boolean {
  const body = text.trim();
  if (body === "" || body === title.trim()) return false;
  return questions.length === 0 || body !== questionsListing(questions).trim();
}

/** One event of a thread, as the context rule reads it. */
export interface ContextEvent {
  id: string;
  type: string;
  /** The actor, for example `human@pixel-9` or `claude@ubuntu-01`. */
  by: string | null;
  text: string | null;
}

/** The most messages that the context of a gate shows. */
export const MAX_CONTEXT_MESSAGES = 5;

/**
 * The context of a gate with no body: the `message.agent` events after the last event of a person
 * (`by` = `human@…`) before the `gate.opened` event `gateEvent`, oldest first, at most
 * MAX_CONTEXT_MESSAGES (the newest). `events` are in merge order. [] when the gate event is not in
 * `events`.
 */
export function gateContext(events: readonly ContextEvent[], gateEvent: string): ContextEvent[] {
  const at = events.findIndex((e) => e.id === gateEvent);
  if (at < 0) return [];
  const found: ContextEvent[] = [];
  for (let i = at - 1; i >= 0 && found.length < MAX_CONTEXT_MESSAGES; i--) {
    const event = events[i]!;
    if (event.by?.startsWith("human@")) break;
    if (event.type === "message.agent" && event.text) found.push(event);
  }
  return found.reverse();
}

// ---- Decision picks (openspec task-review-layout, design decision 4). Kotlin: GateTexts.kt. ----

/** True when the person can pick the decisions of a gate: the gate has the option "Request changes". */
export function canPickDecisions(options: readonly string[]): boolean {
  return options.some((o) => o.trim().toLowerCase() === "request changes");
}

/**
 * The answer for the decision picks of a gate, or null when each pick is the recommended option (the
 * gate then gets its recommended option, for example "Confirm"). `picks[i]` is the option label
 * picked for decision i; a missing pick or a label that is not an option counts as the recommended
 * option. The answer "Request changes" makes the agent write a new approach with the picks.
 * `contracts/fixtures/gates/decisions-answer.json`.
 */
export function decisionsAnswer(
  decisions: readonly GateDecision[],
  picks: readonly string[],
): { answer: "Request changes"; comment: string } | null {
  const changed = decisions.flatMap((d, i) => {
    const pick = picks[i];
    return pick !== undefined && pick !== d.recommended && d.options.includes(pick)
      ? [`- ${d.question}: ${pick}`]
      : [];
  });
  if (changed.length === 0) return null;
  const lines = ["My choices for the decisions:", ...changed];
  if (changed.length < decisions.length) {
    lines.push("Keep the recommended option of the other decisions.");
  }
  return { answer: "Request changes", comment: lines.join("\n") };
}

// ---- Messages of other agents (openspec task-review-layout, design decision 5). Kotlin: Activity.kt. ----

/** A typed `message.human` that is a message of another agent of the session. */
export interface AgentMessage {
  /** `subagent_report`: the final report of a subagent; `agent_message`: a teammate message. */
  kind: "subagent_report" | "agent_message";
  from: string;
  /** The text of the agent, with the frame of Claude Code and the common indent removed. */
  body: string;
}

const OPEN_TAG = /^<agent-message from="([^"]*)">\s*$/;
const CLOSE_TAG = "</agent-message>";
const HAND_BACK = "[Subagent hand-back]";
const REPORT_FOLLOWS = "The report follows:";

/**
 * The message of another agent in the text of a typed `message.human`, or null for a person
 * message. Claude Code sends a subagent report or a teammate message to the UserPromptSubmit hook
 * as `<agent-message from="<id>">` … `</agent-message>`; the transcript form has one prefix line
 * ending in ":" and a note after the tag. `contracts/fixtures/activity/agent-message.json`.
 */
export function agentMessage(text: string): AgentMessage | null {
  const lines = text.split("\n");
  const open = lines.findIndex((l) => OPEN_TAG.test(l.trim()));
  if (open < 0 || open > 1) return null;
  if (open === 1 && !lines[0]!.trim().endsWith(":")) return null;
  let close = -1;
  for (let i = lines.length - 1; i > open; i--) {
    if (lines[i]!.trim() === CLOSE_TAG) {
      close = i;
      break;
    }
  }
  if (close < 0) return null;
  const from = OPEN_TAG.exec(lines[open]!.trim())![1]!;
  let inner = lines.slice(open + 1, close);
  let kind: AgentMessage["kind"] = "agent_message";
  if (inner[0]?.startsWith(HAND_BACK)) {
    kind = "subagent_report";
    const follows = inner.findIndex((l) => l.trimEnd().endsWith(REPORT_FOLLOWS));
    inner = inner.slice(follows < 0 ? 1 : follows + 1);
  }
  return { kind, from, body: dedent(inner) };
}

/** The lines with the common indent of the non-empty lines removed, and no empty first or last line. */
function dedent(lines: readonly string[]): string {
  const filled = lines.filter((l) => l.trim() !== "");
  const indent = Math.min(...filled.map((l) => l.length - l.trimStart().length));
  const cut = filled.length === 0 ? [] : lines.map((l) => (l.trim() === "" ? "" : l.slice(indent)));
  while (cut.length > 0 && cut[0] === "") cut.shift();
  while (cut.length > 0 && cut.at(-1) === "") cut.pop();
  return cut.join("\n");
}
