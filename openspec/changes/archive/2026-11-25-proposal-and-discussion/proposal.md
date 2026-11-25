## Why

The person cannot follow a task in Activity. A real Discuss stage of 5 hours had 5 approach versions, 8 gates, each question twice (a message and a gate), a question "May I write approach v5?" that stayed open after v5 came, and 5 row styles. The AW skill causes this: it gives the agent 8 kinds of update, puts decisions in the approach, and has no rule that questions come before the plan. The term "approach" is also not the term that the person uses.

## What Changes

- **BREAKING** The term "approach" becomes "proposal" in each place that a person or an agent reads, and in the stored names: the event `approach.proposed` becomes `proposal.proposed`, the gate kind `confirm_approach` becomes `approve_proposal`, the folder `approach/` becomes `proposal/`, the task field `approach` becomes `proposal`. Each reader also reads the old names, because the logs are append-only. An older app does not show a new proposal until it is updated.
- **BREAKING** The `aw approach` command and the MCP tool `approach` become `aw proposal` and `proposal`. The old names stay as aliases of the new ones.
- The Discuss stage is a conversation: the agent sends messages and asks each question in a message (`ask`, with options as buttons). It writes one proposal only when no question is open. A proposal has no open question and no decisions. The agent never asks for permission to write a proposal.
- One proposal: a new version replaces the open one (existing rule), and the person can only approve it or discuss it with a message. "Request changes" on a proposal is removed: a message is the request.
- AW closes the open questions of a task when the agent asks a new question or sends a proposal ("Replaced by a newer question", "Replaced by proposal v5"). A late answer to a closed question becomes a comment (existing rule).
- **BREAKING** The decisions of a gate (`--decisions`, the decision picker and "Send my choices") are removed. Old events keep their `decisions`; the apps do not show them.
- Activity on the desktop and the phone has 3 row styles: a message (agent or person), the proposal card, and a task line. A question is an agent message with its option buttons; an answer is a person message. The "… opened" gate lines, the "Approach vN (file)" lines and the AW notes (`aw@` comments such as "Context compacted") show only in Session. Activity is in time order; the item that needs the person is the last row, above the message box.
- The proposal card opens in full screen with a text size control (14 to 24 px, steps of 2 px). Each app saves the size in the settings of the device and uses it for each proposal.
- The phone Inbox uses the desktop layout: the tabs "Needs you" and "Updates", rows with the reason, the title and the key, the groups "Working now", "Paused" and "Queued", and one item screen per row.
- The AW skill, the session context and the notices teach the new loop.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `task-loop`: the proposal (term, one current version, Approve only), questions as messages that close older questions, no decisions, the gate table.
- `workspace-schemas`: `proposal.proposed`, the gate kind `approve_proposal`, the task field `proposal`, and the old names as aliases.
- `workspace-merge`: the merge folds the old and the new names into the same task state.
- `workspace-files`: the folder `proposal/`; the old folder `approach/` stays readable.
- `agent-claude-plugin`: the skill rules of the Discuss loop, the `ExitPlanMode` hook makes a proposal.
- `mcp-server`: the tool `proposal` (alias `approach`), no `decisions` argument.
- `aw-cli`: `aw proposal` (alias `aw approach`), no `--decisions`.
- `desktop-app`: Activity rows, the proposal card and its full screen view, the text size setting, the Inbox reasons, no decision picker.
- `android-app`: the same Activity, proposal card and full screen view, and the Inbox of the desktop.
- `app-style`: the 3 row styles of Activity.

The other specs that name "approach" only as a term change their text in the same change, with no new requirement.

## Impact

- `shared/schema` (events, gate kinds, task document, aliases), the generated `contracts/` files and Kotlin classes, `contracts/fixtures` (merge and activity).
- `shared/core` merge and files ownership; `android/shared` merge (TaskFold).
- `daemon`: `loop/agent.ts`, `loop/loop.ts`, `loop/ready.ts`, `sessions/manager.ts`, `sessions/context.ts`, `sessions/task-paths.ts`, `mcp/tools.ts`, `cli/agent.ts`, the API routes.
- `plugins/agent-claude`: `SKILL.md`, the hooks.
- `desktop`: `Thread.tsx`, `GateCard.tsx`, `GateParts.tsx`, `TaskDetail.tsx`, `Inbox.tsx`, `model.ts`, `activity-model.ts`, settings.
- `android`: `control` (Activity rule, Inbox, Screens) and `app` (TaskScreens, GateParts, ListScreens, settings).
- Docs: `docs/prd.md` 6, `docs/workflow.md` 3, 4.4, 4.5 and 8, `docs/design.md` 8.6, a new decision `docs/decisions/2026-11-26-proposal-and-discussion.md`.
- Release: `feat!` (major). Each device must update; an older app does not show a new proposal.
