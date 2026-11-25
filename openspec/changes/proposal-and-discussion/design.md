## Context

The Discuss stage of a real task (5 hours, 5 versions) showed the problems. The agent sent each question twice: with `message` and with `ask`, because the skill says "put the full context in `details` of `ask`". It put choices in the approach file and asked "May I write approach v5?" as a gate. That gate stayed open after v5 came, and the person answered it 5 hours later from the phone. Activity showed 5 row styles: agent messages, "… opened" gate lines, "Approach vN (file)" lines, sent messages and an `aw@` comment.

AW already replaces an open approach gate with each new version (`replaceOpen` in `daemon/src/loop/agent.ts`, answer "Replaced by approach v<n>"). It does not close a question gate. The approach gate has decisions (`--decisions`) and two answers: "Confirm" and "Request changes".

The prototype that the person approved: the Design canvas "AW Activity: messages and one proposal" (9 artboards, desktop and phone).

## Goals / Non-Goals

**Goals:**
- One term, "proposal", in the UI, the docs, the skill, the CLI, the MCP tools and the stored names.
- Discuss is a conversation: messages, questions as messages, then one proposal with no open question.
- The person approves a proposal or discusses it with a message. Nothing else.
- Activity has 3 row styles on both apps. The phone Inbox is the desktop Inbox.
- A proposal can be read in full screen with a text size that the device keeps.

**Non-Goals:**
- No change to "Approve result", "Approve command", Assign or the other gates, except their place in Activity.
- No rewrite of old log lines. No migration step on a device.
- No change to the stages.

## Decisions

### 1. Rename the stored names, and read the old names

Writers write only the new names: the event `proposal.proposed`, the gate kind `approve_proposal`, the files `proposal/v<n>.md`, the task field `proposal`. Readers map the old names to the new names when they parse: `approach.proposed` → `proposal.proposed`, `confirm_approach` → `approve_proposal`, the `task.yaml` field `approach` → `proposal` when `proposal` is missing. The map is in one place in each language: `shared/schema` (`legacy.ts`) and `android/shared`. A file path in an old event stays as written (`approach/v3.md`), so the reader opens the right file.

The version number continues: a task with approach v5 gets proposal v6.

Alternative: rename only the text that people and agents read. Rejected: the agent reads event types and file paths in `aw thread`, so "approach" would stay in front of it, and `AGENTS.md` asks for one term in the code too.

### 2. Aliases of the agent commands

`aw approach` and the MCP tool `approach` stay as aliases of `aw proposal` and `proposal` for one major version, so an agent with an old skill text still works. The skill and the help name only `proposal`.

### 3. Questions are messages; a new question or proposal closes the older ones

A question stays a gate (kind `question` or `reply`): it keeps the needs-you lane, the push, the answer and the resolution rules. Activity shows it as an agent message with its options as buttons; the answer shows as a person message. When the agent asks a new question or sends a proposal, AW resolves each open `question` and `reply` gate of the task with "Replaced by a newer question" or "Replaced by proposal v<n>" (the same mechanism as `replaceOpen`). A late answer then becomes a comment (existing rule 2 of the gate table).

The skill says: ask with `ask` only (not also with `message`); one `ask` per turn; put every question that you have in it.

### 4. One proposal, Approve only

The gate `approve_proposal` has one option: "Approve". A message from the person while the gate is open is the discussion; the gate stays open until the person approves or a new version replaces it. The daemon accepts "Approve" and the old "Confirm" as approval. "Request changes" on an old open gate still works as a message with the comment.

### 5. Remove the decisions

`aw proposal`, `aw gate` and the MCP tools refuse `decisions`. The schema keeps `decisions` on `gate.opened` with the default `[]`, so old events parse. The apps do not show decisions; the Session view shows the raw event. `decisionsAnswer`, `canPickDecisions` and the decision picker are removed.

### 6. The Activity rule

One shared fixture (`contracts/fixtures/activity/cases.json`) decides, for each event, the row style and the text. The new rows:

| Event | Activity row |
|---|---|
| `message.agent` (tool or no source), a typed `message.human`, a subagent report | message |
| `message.sent`, `comment.added` by a person | message |
| `comment.added` by `aw@…` | Session only |
| `gate.opened` `question`/`reply` | agent message with the gate text, the options as buttons while open |
| `gate.answered` of a question or reply | person message, the answer and the comment |
| `proposal.proposed` (current version) | the proposal card |
| `proposal.proposed` (replaced version) | task line "Proposal v<n> · replaced by v<m>" |
| `gate.opened` `approve_proposal` | none (the proposal card shows it) |
| `gate.answered` of a proposal | task line "Proposal v<n> approved by <who>" |
| `gate.opened` other kinds, open | the gate card at its place in time |
| `gate.opened` other kinds, closed | task line "<gate> answered: <answer>" |
| `gate.resolved` | Session only |
| task events (created, assigned, stage, done, …) | task line |

The Assign card and a pause stay at the top of Activity, because they are states of the task and not events. Activity is in time order; the header chip "Needs you: <reason>" scrolls to the row that needs the person.

### 7. Full screen and text size

The proposal card has a full screen button. The full screen view has the title, A− and A+ (14 to 24 px, steps of 2 px, default 16 px), Close (Esc), Approve and Discuss. Discuss closes the view and puts the cursor in the message box. The size is a device setting: the desktop keeps `proposal_text_px` in `aw-desktop.json` (`DesktopPrefs`); the phone keeps the file `proposal-text-px` in its files folder (as `MobileDataSetting`). The card uses the same size. The rule (clamp, steps) is in `shared/client` and in `android/control`, tested with the same cases.

### 8. Phone Inbox

The phone Inbox has the tabs, rows and groups of the desktop. The rows come from the same rule: the desktop `inboxItems` moves to `shared/client`, the phone gets a port in `android/control`, and both test it against a new fixture `contracts/fixtures/inbox/items.json`. A tap opens the item screen: the row of Activity that needs the person (the question message or the proposal card, or the gate card), and "Open task".

### 9. Teach the agent

`SKILL.md` gets the Discuss loop: read the thread and the knowledge; send short messages; ask with `ask` (all questions in one, options as buttons, recommendation in the text); write a proposal with `proposal` only when no question is open; the proposal has no question and no choice; never ask for permission to write it; after a message about the proposal, answer it or write a new version. The session context and the notices use "proposal": "Proposal v2 approved. Run `aw ready AW-12` and end your turn."

## Risks / Trade-offs

- [An older app reads a new log] → It does not know `proposal.proposed` and `approve_proposal`, so it shows them only in Session and cannot approve. Mitigation: a major release; the release notes say "update each device".
- [A real agent ignores the new rules] → The skill is the only lever. Mitigation: one real Claude Code run on a synthetic task before the merge; the result goes in the PR.
- [Closing older questions closes one that the person still wants to answer] → The agent asked a newer question that holds what it still needs (skill rule). The old question and the answer stay in Session.
- [Removing decisions loses a feature that was just merged] → The person asked for it: questions go in messages before the proposal.

## Migration Plan

1. Release the new apps and awd together (major version).
2. No data step: the readers map the old names. New writes use the new names.
3. Rollback: revert the squash commit. Events written with the new names are then unknown to the old reader and show in Session only; the person approves them again after the next proposal.

## Open Questions

None. The phone keeps its Home tab (the person did not ask to remove it).
