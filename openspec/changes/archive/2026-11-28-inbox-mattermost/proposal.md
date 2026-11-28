## Why

People get requests, questions and news in chat tools, and they copy them into tasks by hand. The PRD planned sources and signals for phase 2 (SIG-01 to SIG-11). The person asked for a first source now: Mattermost, sorted by an agent into Action, Question and Info, with a suggested task or answer (prototype `inbox-prototype` v6, approved 2026-11-27).

## What Changes

- **BREAKING** The Inbox screen shows cards of incoming messages, not the items that need the person (they move to Tasks › Needs you, change `nav-tasks-needs-you`).
- A source plugin interface `Source` in `shared/plugin-api` and the plugin `plugins/source-mattermost` (REST API v4 through `@mattermost/client`, personal access token).
- A source configuration with one collecting device: the main device or the remote device. The phone never reads Mattermost. A person moves the collection to another computer.
- The collecting awd reads the direct messages, the groups and the channels that the person selects, with a read level for each conversation (All, Only for me, Off), every minute.
- A triage session: one long-running Claude Code session in tmux on the collecting device, not a task. It gets batches and writes cards through new MCP tools. It resumes after a restart.
- A card has a category (Action, Question, Info), an urgency (high, normal, low), a title, a summary, the original messages word for word, an optional project and a suggestion: a task for an Action, an answer for a Question.
- One thread is one card. A new message in the thread updates the card and marks it unread again.
- Person actions on a card, on the desktop and the phone: mark read or unread, done or not done, change the category or the project, create the suggested task (a task always has a project), send a reply to the thread (with a preview; never posted twice), ask the agent about the card.
- "Run now" reads the source and sends the waiting messages at once.
- Sources page on the desktop: the connection, the collecting device, the triage settings (model, schedule, instruction), the conversations with their project and read level.
- New `aw inbox` and `aw source` commands, local API routes and MCP tools that call the same service code.
- Push to the phone only for a card with high urgency.

## Capabilities

### New Capabilities
- `inbox-sources`: the `Source` interface, the Mattermost plugin, the source configuration, the collecting device, the read levels and the cursors.
- `inbox-triage`: the triage session, the batches, the MCP tools of the triage session and the asks.
- `inbox-cards`: the card events and their merge, the person actions, the reply to the source, the desktop Inbox with the card dialog, the phone Inbox and the push.

### Modified Capabilities
- `mcp-server`: a token of the triage session that opens only the triage tools.
- `aw-cli`: the commands `aw inbox` and `aw source`.
- `local-api`: the inbox and source routes.
- `workspace-schemas`: the new event types and the `inbox` part of device health.

## Impact

- New: `shared/plugin-api/src/source.ts`, `plugins/source-mattermost/`, `daemon/src/inbox/`, `desktop/.../Inbox.tsx` (rewritten), `CardDialog.tsx`, `Sources.tsx`, Kotlin `InboxCards.kt` and the phone Inbox screens.
- Changed: `shared/schema` events and health, `shared/core` merge (workspace fold), `android/shared` merge, `daemon/src/mcp`, `daemon/src/api`, `daemon/src/cli`, the fake agent, `contracts/`.
- Dependency: `@mattermost/client` 11.9 (official, MIT).
- Cost: the triage session uses the Claude plan of the collecting device. A batch runs only when new messages wait.
- Docs: a decision document, `prd.md` 8.10 (SIG and INB rows), `architecture.md` 6.2, `phase-1.md`.
