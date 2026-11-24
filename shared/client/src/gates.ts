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
