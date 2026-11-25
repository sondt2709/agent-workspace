// The texts that AW gives a session: the first input (docs/phase-1.md 9.2.1), the SessionStart
// context (9.2.2, at most 10,000 characters) and the continue message of a resume (docs/architecture.md
// 4.6.4). They are plain functions of the task, so the tests check them directly.
import type { TaskView } from "@aw/core";

export const MAX_CONTEXT_CHARS = 10_000;
export const RESUME_PREFIX = "[AW resume]";
/**
 * The longest message in the argv of the agent. Linux refuses one argument over 128 KiB
 * (MAX_ARG_STRLEN) with E2BIG, and then no agent starts.
 */
export const MAX_MESSAGE_ARG_BYTES = 96 * 1024;

/**
 * The message of the agent argv (aw-launch): the input as is, or, when it does not fit in one
 * argument, a short text that names the file of the input (the agent reads it word for word).
 */
export function launchMessage(message: string, file: string): string {
  if (Buffer.byteLength(message) <= MAX_MESSAGE_ARG_BYTES) return message;
  return `[AW] Your first input is ${message.length} characters long, too long for the command line. Read the file ${file} first: it is your first input, word for word. Then work on it.`;
}

/** "Read `aw thread <key> --ancestors` before you act." */
export function readThreadLine(key: string): string {
  return `Read \`aw thread ${key} --ancestors\` before you act.`;
}

/**
 * The first input. A Discuss session gets the first message as is. A session with an approved
 * proposal, or of a subtask, gets the first message first (so a command such as /opsx:apply stays at
 * the start), then the proposal word for word, then the thread line.
 */
export function firstInput(task: TaskView, proposal: string | null): string {
  const message = task.first_message ?? "";
  if (proposal === null && task.parent === null) return message;
  const key = task.key ?? task.id;
  const parts = [message];
  if (proposal !== null) parts.push(`Approved proposal:\n\n${proposal}`);
  parts.push(readThreadLine(key));
  // A session that starts at Ready (a subtask with the proposal of its parent) never gets "Proposal
  // v<n> approved", so it gets the ready step here (review task-loop, workflow problem 2).
  const subtaskAtReady =
    task.stage === "backlog" && task.parent !== null && task.proposal.approved === null;
  if (proposal !== null && (task.stage === "ready" || subtaskAtReady)) {
    parts.push(readyLine(key));
  }
  return parts.join("\n\n");
}

/** The ready step of a session that starts at Ready. */
export function readyLine(key: string): string {
  return `${key} is at Ready: the proposal is approved. Run \`aw ready ${key}\` (add --missing "<item>" for each thing that you still need) and end your turn. "Start implementing" arrives as your next input.`;
}

/**
 * The knowledge part of a SessionStart context when the knowledge store gives no context (for
 * example a task with no project): the cause and the command that shows the knowledge.
 */
export function knowledgeUnavailable(task: TaskView, cause: string): string {
  const key = task.key ?? task.id;
  return [
    "## Knowledge",
    `- AW could not build the knowledge context: ${cause}`,
    `- Run \`aw kb context ${key}\` or \`aw kb list\` to see the knowledge files.`,
  ].join("\n");
}

/**
 * The SessionStart context: the task fields, the gates, the rules, and the knowledge context of
 * the knowledge store (its short header and file list, `KnowledgeService.context`).
 */
export function sessionContext(task: TaskView, knowledge: string): string {
  const key = task.key ?? task.id;
  const open = task.gates.filter((g) => g.state === "open");
  const lines = [
    `# AW task ${key}: ${task.title ?? ""}`,
    "",
    "Agent Workspace (AW) started this session. The human is NOT at this terminal. Your text output goes only to the Session log: the human reads only what you send through AW.",
    readThreadLine(key),
    "",
    "## Rules",
    `- End EACH turn with one AW call: a question, the proposal, ready, the result, a gate, \`aw message ${key} "<short update>"\`, learn or done. "[AW notice <id>] Your turn ended with no AW update" means: send that update now.`,
    `- Discuss: ask each question only with \`aw ask ${key} "<question>" --options "a|b"\` (never also as a message), all your questions in one ask, then END YOUR TURN. The answer arrives as your next input, after "[AW answer <gate-id>]".`,
    `- Write the proposal with \`aw proposal ${key} --file <path>\` only when no question is open. A proposal has no open question and no choice. Never ask for permission to write a proposal. After a message about the proposal, answer it or send a new version.`,
    `- Put the full context of a decision (the options, trade-offs, risks, your recommendation) in the question: \`aw ask ${key} "<question>" --details-file <file.md> --option "<label>::<description>"\`. The human sees only the gate: never write "see the message above".`,
    `- Keep a message short, for a phone screen. Do not copy a gate or a result into it. Write messages, progress, artifacts and a handoff with \`aw message ${key}\`, \`aw stage ${key}\`, \`aw artifact add ${key} <file>\`, \`aw handoff ${key} --file <path>\`.`,
    "- An input that starts with [AW resume] means AW restarted this session: check the interrupted step first.",
    `- Search the knowledge first: read the "Read now" files below, and run \`aw kb search <terms>\` before you plan.`,
    `- Before \`aw done ${key}\`, record what you learned: \`aw learn ${key} --file <path> --title <title>\` for each item, or \`aw learn ${key} --nothing-new\`.`,
    "",
    "## Task",
    `- Key: ${key}`,
    `- Id: ${task.id}`,
    `- Project: ${task.project ?? "-"}`,
    `- Stage: ${task.stage}`,
    `- Assignee: ${task.assignee ?? "-"}`,
    `- Branch: ${task.branch ?? "-"}`,
    `- Parent: ${task.parent ?? "-"}`,
    `- Test server: ${task.test_server ?? "-"}`,
    `- Credentials: ${task.credentials.length > 0 ? task.credentials.join(", ") : "-"}`,
    `- Links: ${task.links.length > 0 ? task.links.join(", ") : "-"}`,
    `- Proposal: latest v${task.proposal.latest}, approved ${task.proposal.approved === null ? "none" : `v${task.proposal.approved}`}`,
    "",
    "## Open gates",
    ...(open.length === 0
      ? ["- none"]
      : open.map((g) => `- ${g.gate} (${g.kind}, version ${g.version}): ${g.title}`)),
    "",
    knowledge.trimEnd(),
  ];
  let text = lines.join("\n");
  if (text.length > MAX_CONTEXT_CHARS) {
    // Cut at a line end, so no file path is cut in two.
    const tail = `\n- ... more knowledge files: run \`aw kb context ${key}\`. ${readThreadLine(key)}`;
    const cut = text.slice(0, MAX_CONTEXT_CHARS - tail.length);
    const end = cut.lastIndexOf("\n");
    text = `${end > 0 ? cut.slice(0, end) : cut}${tail}`;
  }
  return text;
}

/** The continue message of a resume. It names the interrupted step, else says that none ran. */
export function continueMessage(
  stoppedAt: string,
  step: { tool: string; summary: string } | null,
): string {
  const time = stoppedAt.slice(11, 19);
  const what =
    step === null
      ? "No tool was running. Continue the task."
      : `The interrupted step was ${step.tool}: ${step.summary}. Check its result before you run it again.`;
  return `${RESUME_PREFIX} AW resumed this session after the agent process stopped at ${time} UTC. ${what}`;
}

/**
 * A short text of a tool input: the command of Bash, the file of Write and Edit, else JSON. `redact`
 * is the redaction of the files layer: it runs on the full text before the cut (fix list 0-41).
 */
export function toolSummary(
  tool: string,
  input: Record<string, unknown>,
  redact: (text: string) => string,
): string {
  const pick = (name: string) => {
    const value = input[name];
    return typeof value === "string" ? value : null;
  };
  const text = redact(
    pick("command") ?? pick("file_path") ?? pick("path") ?? JSON.stringify(input),
  );
  return `${text.slice(0, 300)}${text.length > 300 ? "…" : ""}`.replace(/\s+/g, " ") || tool;
}

/** True when the agent text ends with a question (after spaces and Markdown marks). */
export function endsWithQuestion(text: string): boolean {
  return /\?[\s*_`)"'»\]]*$/.test(text);
}
