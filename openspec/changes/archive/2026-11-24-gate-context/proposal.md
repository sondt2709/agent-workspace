## Why

When an agent asks a multiple-choice question, the gate card shows only the question line and the choices (owner bug, 2026-11-24, fix list ux-4). The agent wrote its analysis with `aw message` and asked "Which option? (see the gate message above)", but `aw ask` takes no details, the card does not show the earlier messages, and the AskUserQuestion mapping drops the option descriptions, the header, multiSelect and the options of a second question. The person cannot decide from the card.

## What Changes

- `aw ask` gets `--details <text>`, `--details-file <path>` and `--option "<label>::<description>"`. The MCP tool `ask` and the local API ask body get `details` and option objects `{label, description}`.
- awd writes the question gate with the question as the title and the details as the text. Details over 16 KiB keep their start in the event and the full text in `artifacts/<device>/text-<gate>.md`.
- `gate.opened` gets the optional field `questions` (each question with its header, `multi_select` and options with descriptions). Additive; old readers keep `options`.
- AskUserQuestion keeps each question, header, multiSelect and option description. With 2 or more questions or a multiSelect question, the card shows each question with its options and one "Send answers" button. The answer text uses the Claude Code tool result format `"<question>"="<label>", …`.
- The gate cards on the desktop (Inbox detail and Activity) and on the phone show the details above the choices, with "Show more" for a long text. A question or reply gate with no details shows "Context": the agent messages since the last person event before the gate.
- The plugin skill, the MCP server instructions and the session context tell the agent to put the full decision context in the question.
- The push and the notification keep the question line.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `aw-cli`: `aw ask` takes details and option descriptions.
- `mcp-server`: the `ask` tool takes `details` and option objects; the instructions tell the agent where the context goes.
- `agent-sessions`: the question gate stores the question as the title and the details as the text; AskUserQuestion keeps questions, headers, multiSelect and descriptions.
- `workspace-schemas`: `gate.opened.questions`.
- `agent-claude-plugin`: the skill rule for the decision context; the fake agent step `ask-tool-json`.
- `desktop-app`: gate cards with details, Context, and a question list.
- `android-app`: the same gate cards on the phone.
- `push-sender`: the push of a question gate keeps the question line, not the details.

## Impact

- Code: `shared/schema`, `shared/client` (`gates.ts`, `session-schemas.ts`), `daemon` (CLI, session manager, MCP tools, session context), `plugins/agent-claude` (`toolGate`, skill, fake agent), `desktop` (gate cards, queries), `android/control` and `android/app` (gate card model and view).
- Contracts: generated JSON Schemas, samples and Kotlin classes; `contracts/openapi.yaml`; new fixtures `contracts/fixtures/gates/questions.json` and `context.json`.
- Docs: `docs/workflow.md` 3 and 8, `docs/phase-1.md`, `docs/design.md` 8.7.
- No new dependency.
