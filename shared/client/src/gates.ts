// The rules of gate texts and proposals that both apps use. Kotlin: GateTexts.kt and Activity.kt.

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

// ---- Proposal text size (openspec proposal-and-discussion, design decision 7). Kotlin: ProposalTextSize.kt. ----

/** The text size of a proposal: 14 to 24 px in steps of 2, 16 px by default. */
export const PROPOSAL_TEXT = { min: 14, max: 24, step: 2, default: 16 } as const;

/**
 * The size from the saved value of the device: the default for no value, a value that is not a
 * whole number or not on a step; a whole number out of range gets the nearest limit.
 * `contracts/fixtures/gates/proposal-text-size.json`.
 */
export function loadProposalTextSize(saved: string | null): number {
  if (saved === null || !/^-?[0-9]+$/.test(saved.trim())) return PROPOSAL_TEXT.default;
  const n = Number(saved.trim());
  if (n < PROPOSAL_TEXT.min) return PROPOSAL_TEXT.min;
  if (n > PROPOSAL_TEXT.max) return PROPOSAL_TEXT.max;
  return (n - PROPOSAL_TEXT.min) % PROPOSAL_TEXT.step === 0 ? n : PROPOSAL_TEXT.default;
}

/** The next size for A+ (`larger`) or A− (`smaller`), within the limits. */
export function changeProposalTextSize(size: number, action: "larger" | "smaller"): number {
  const next = size + (action === "larger" ? PROPOSAL_TEXT.step : -PROPOSAL_TEXT.step);
  return Math.min(PROPOSAL_TEXT.max, Math.max(PROPOSAL_TEXT.min, next));
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
