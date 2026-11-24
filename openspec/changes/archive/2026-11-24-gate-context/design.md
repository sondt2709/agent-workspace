## Context

A question gate has a `title` (the first line of the question) and a `text` (the full question). `aw ask <task> <text> --options "a|b"` and the MCP tool `ask` take only that text and option labels. The gate card on the desktop (`GateCard.tsx`, in the Inbox detail and in Activity through `NeedsYouCards`) and on the phone (`GateCardView`) shows the title, the text and one button per option. In a trial the agent wrote its analysis with `aw message` and asked "Which option? (see the gate message above)": the card showed that line and 4 buttons. `toolGate` of the Claude plugin maps AskUserQuestion to labels only: it drops each option description, the header and multiSelect, and with 2 or more questions it gives no option at all (base evidence: `base-toolgate-9e7470e.log`).

The answer of a gate goes to the session as the next input: `[AW answer <gate>] <answer>` (the hook denies AskUserQuestion, so Claude Code never gets a tool result).

## Goals / Non-Goals

**Goals:**
- The agent can put the full decision context into the question gate, and the card shows it above the choices.
- An old gate, or a gate of an agent that does not use details, still shows the information: the agent messages before the gate.
- AskUserQuestion keeps all its parts, and the person can answer each question.
- One rule set in both languages, checked by shared fixtures.

**Non-Goals:**
- Markdown on the phone (Q15 is open; the phone shows plain text).
- A per-question free text ("Other") field. The whole-gate free text stays.
- A change of the delivery path of answers.

## Decisions

1. **Details in the gate text.** With details, awd writes `title` = the question (redacted, line breaks as spaces, at most 500 characters) and `text` = the details. Without details, the gate is as before. The details limit is the approach limit: at most 256 KiB characters (`MAX_GATE_FILE_CHARS`); over 16 KiB (`MAX_GATE_TEXT_CHARS`), awd writes the full redacted text to `artifacts/<device>/text-<gate>.md` (the long-text name of docs/phase-1.md 3.3), puts the first 16 KiB and a pointer line in `text` (`gateText`), and names the file in `file`. Alternative: a new field `details`. Rejected: `text` already carries the body of the other gates, and older UIs show it.
2. **"Has a body" rule.** A gate has a body when its text, trimmed, is not empty and not equal to its trimmed title. No new flag: the rule also works for old gates. `gateHasBody(title, text)`.
3. **Context fallback.** For a `question` or `reply` gate with no body, the card shows "Context": the texts of `message.agent` events after the last event whose `by` starts with `human@`, before the `gate.opened` event, in merge order, at most the 5 newest. The function `gateContext(events, gateEventId)` is in `@aw/client/gates` and in Kotlin `GateTexts.context`. Fixture: `contracts/fixtures/gates/context.json`. The desktop reads the events with the thread route `before=<hlc>~<dev>~<id>` of the `gate.opened` event and `limit=200` (one query per card that needs it). The phone reads the newest 500 events of the task from its index (`threadNewest`); a gate older than that window shows no context. Alternative: awd copies the messages into the gate. Rejected: it does not help old gates, and it duplicates text in the log.
4. **Option descriptions and several questions: `gate.opened.questions`.** A list of `{question, header, multi_select, options: [{label, description}]}` (snake_case, all strings redacted by the schema redaction, default `[]`). awd writes it for AskUserQuestion always, and for `aw ask` when an option has a description. `options` keeps the labels when there is one question with `multi_select: false`; else `options` is `[]`. An older reader then shows buttons or the free text, as before. Limits: at most 10 questions, 20 options, a label 500 and a description 2,000 characters, a header 100 characters.
5. **CLI options.** `--details <text>`, `--details-file <path|->` (the path check of `aw approach --file`: in the session folder after each symlink), `--option "<label>::<description>"` (repeat; the first `::` splits). `--details` with `--details-file`, or `--options` with `--option`, is invalid input (exit 2). The MCP tool `ask` takes `details` and `options` items as a string or `{label, description}`.
6. **Answer of several questions.** The card shows each question with its header and its options (with descriptions). A single-choice question takes one pick, a multiSelect question takes any picks. "Send answers" sends one text in the format of the Claude Code 2.1.331 AskUserQuestion tool result: `"<question>"="<answer>"` for each question, joined by `, `; the labels of a multiSelect pick joined by `, `; a question with no pick gives `"<question>"=(no option selected)`. The agent reads it as its own tool result. Function `questionAnswer(questions, picks)` in both languages; fixture `contracts/fixtures/gates/questions.json`. A gate with one single-choice question keeps one-click buttons, and each button shows its description.
7. **Long text in the card.** Desktop: the details render as Markdown in a box of at most 12 lines (240 px) with "Show more" / "Show less"; Context shows each message as raw text (the exact agent text, as in Activity), clamped to 6 lines with "Show more". Phone: plain text with `ActivityRule.clamp` (6 lines) and "Show more".
8. **Agent guidance.** The skill, the MCP instructions and the session context say: put the full context of a decision (the options, the trade-offs, the risks, your recommendation) in the question with `aw ask --details-file` or MCP `details`; never "see the message above". The SKILL.md stays below 6,000 characters.
9. **Push and notification.** No change of code: both use `gate.title`, which is the question line. Tests check that the details are not in them.
10. **Fake agent.** New step `ask-tool-json <json>`: calls AskUserQuestion with that tool input, for the journeys and the e2e test. The base `ask-tool` step keeps its form.

11. **The prompt of the turn sorts first.** `message` and `stage` drain the hook spool of the session before they write, as `ask` and the work-loop commands do. Else the UserPromptSubmit event of the turn (a person event) can get a later HLC than the agent's analysis, and the context of the next gate stops at it. Found by the Docker e2e on the first commit (1 of 2 runs).

## Risks / Trade-offs

- [The answer format is a contract with the agent] → it copies Claude Code's own format, and both languages run one fixture.
- [The context rule can pick a message that is not about the question] → it takes only messages after the last person event before the gate, and at most 5; the card labels them "Context" with the author and time.
- [One more thread query per card with no body] → only for question and reply gates with no body; limit 200; cached by the query client.
- [An agent keeps using "see the message above"] → the Context fallback shows the messages anyway.
