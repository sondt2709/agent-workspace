## 1. Contract and docs

- [ ] 1.1 Write the decision `docs/decisions/2026-11-26-proposal-and-discussion.md`, and update `docs/prd.md` 6, `docs/workflow.md` 3, 4.4, 4.5 and 8, `docs/design.md` 8.6 and 8.19, `docs/phase-1.md` and `docs/architecture.md` to "proposal"
- [ ] 1.2 `shared/schema`: `proposal.proposed`, the gate kind `approve_proposal`, the task field `proposal`, and `legacy.ts` that maps the old names when a reader parses; tests with a fixture of old lines
- [ ] 1.3 Regenerate `contracts/schemas`, `contracts/samples`, `contracts/openapi.yaml` and the Kotlin classes
- [ ] 1.4 `shared/core`: the merge folds both names (approve on `approve` or `confirm`), the files layout has `proposal/` and keeps `approach/` read-only; update the merge fixtures
- [ ] 1.5 `android/shared`: the same map and fold in Kotlin, tested with the same fixtures

## 2. awd and the agent

- [ ] 2.1 `daemon/src/loop/agent.ts`: `proposeProposal` (`proposal/v<n>.md`, one option "Approve", no decisions), `gate` without decisions, and the resolve of the older open questions on `ask`, `AskUserQuestion`, the reply gate and `proposal`
- [ ] 2.2 `loop.ts`, `ready.ts`, `sessions/context.ts`, `sessions/manager.ts`, `sessions/task-paths.ts`: the term, the notices ("Proposal v<n> approved…"), the first input with the approved proposal, the `ExitPlanMode` hook
- [ ] 2.3 The MCP tool `proposal` (alias `approach`), the CLI `aw proposal` (alias `aw approach`), the route `/proposal` (alias `/approach`); refuse `decisions`
- [ ] 2.4 `plugins/agent-claude/plugin/skills/aw/SKILL.md` and the MCP server instructions: the Discuss loop; the contract test of the skill text
- [ ] 2.5 Daemon tests: a new question closes the older one, a proposal closes the questions, the alias tool and command, an old `confirm_approach` gate answered "Confirm" moves to Ready

## 3. Shared UI rules

- [ ] 3.1 `contracts/fixtures/activity/cases.json`: the row style and text of each case (message, proposal card, task line, Session only), with old and new names
- [ ] 3.2 `shared/client`: `proposalTextSize` with `contracts/fixtures/gates/proposal-text-size.json`; `inboxItems` moved from the desktop with `contracts/fixtures/inbox/items.json`; remove `decisionsAnswer` and `canPickDecisions` and their fixture

## 4. Desktop

- [ ] 4.1 `activity-model.ts` and `Thread.tsx`: the 3 row styles, the question as a message with buttons, the answer as a person message, the replaced proposal line, no `aw@` comment
- [ ] 4.2 The proposal card, the full screen view (Esc, Discuss) and the text size in `DesktopPrefs` (`proposal_text_px`)
- [ ] 4.3 `GateCard.tsx` and `GateParts.tsx`: remove the decision picker; the Approve result and other cards in their place in time; the header chip scrolls to the row that needs the person
- [ ] 4.4 Inbox reasons and detail with the Activity rows; the Proposal field of Properties
- [ ] 4.5 Desktop tests for each new rule, each able to fail

## 5. Android

- [ ] 5.1 `control`: the Activity rule from the shared fixture, `ProposalTextSize`, `InboxItems` from the shared fixture, no decisions; tests
- [ ] 5.2 `app`: the 3 row styles, the question message with 48 dp buttons, the proposal card and its full screen view, the text size file
- [ ] 5.3 `app`: the Inbox of the desktop (tabs, rows, groups, item screen)

## 6. Verify

- [ ] 6.1 `task check` (TypeScript and Android) and `task leakcheck`; break each new rule once
- [ ] 6.2 E2E with the fake agent: question, answer, a second question closes the first, proposal v1, a message, proposal v2 replaces v1, Approve moves to Ready
- [ ] 6.3 Screenshots before and after: desktop and phone (Activity, proposal full screen, Inbox)
- [ ] 6.4 One real Claude Code session on a synthetic task: it asks with `ask` only, writes one proposal with no question, and never asks for permission to write it
