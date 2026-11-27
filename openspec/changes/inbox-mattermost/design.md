## Context

AW has no message source yet. The PRD planned sources and signals for phase 2 (`prd.md` 8.10, `architecture.md` 6.2 "Source"). A common design for a chat inbox collects posts by REST polling, sends them in batches to an agent session, and gets cards back (category, urgency, summary, suggested reply). AW keeps all state in files that sync between the devices: YAML documents and append-only JSON Lines logs per device, folded by the merge in TypeScript (`shared/core`) and in Kotlin (`android/shared`).

The person decided (2026-11-27):
1. The source is a plugin module. Use the Mattermost MCP server or `@mattermost/client`, with evidence.
2. One collecting device at a time: the main device or the remote device. The phone never reads Mattermost.
3. Adding the token from the phone is out of scope.
4. A card can have no project. A task always has a project. The triage session is not a task.
5. One triage session (a long-running Claude Code session), not one run per batch.

## Goals / Non-Goals

**Goals:**
- Collect Mattermost messages on one computer, also while the laptop is closed (when the remote device collects).
- Sort them with an agent into cards, with the original words (principle 8).
- Act on a card from the desktop and the phone (principle 1): read state, done, category, project, task, reply, ask.
- Never post a reply twice. Never post without a click of the person.

**Non-Goals:**
- WhatsApp, Gmail, "Save to knowledge" of an Info card.
- Adding or replacing the Mattermost token from the phone.
- Editing the source configuration from the phone (the phone shows it read-only).
- A WebSocket connection to Mattermost (polling only).
- Retention and pruning of old cards (the logs are append-only; see Risks).

## Decisions

### 1. `@mattermost/client`, not the Mattermost MCP server
Evidence (Mattermost 12.1 `mattermost/mattermost-preview`, 2026-11-27): the MCP server is part of the Agents plugin 2.9 (`mattermost-plugin-agents`, plugin id `mattermost-ai`). The plugin is prepackaged but not enabled: `GET /plugins/mattermost-ai/mcp` gives 404. Its binary needs "embedded MCP server is enabled, authorized" and per-user OAuth. So an admin must enable and configure the plugin (with an LLM provider) on each server. Its tools are for an agent to search and read, with no cursor.
`@mattermost/client` 11.9 is the official REST client (`Client4`), maintained by Mattermost, MIT. It works on each server with a personal access token and gives `getMe`, `getChannelsForTeamForUser`, `getPosts(since)`, `getPostThread`, `createPost` with `pending_post_id`. awd needs deterministic cursors and dedupe, so the collector uses the REST client. The agent never calls Mattermost.

### 2. Plugin interface
`shared/plugin-api/src/source.ts`: `Source { kind; me(); conversations(); collect(cursor) → {messages, cursor}; post({conversation, root, text, pendingId}) → {post, url}; findPending(conversation, pendingId) }`. `plugins/source-mattermost` implements it, one adapter module around `Client4`. A plugin never imports another plugin.

### 3. Storage: events in the workspace log
All inbox state is events in `tasks/log/<device>.jsonl`, folded by `foldWorkspace` in both languages (`contracts/fixtures/inbox/cards.json` tests both). Alternatives: a new log folder or card documents. Rejected for now: each needs a new source in both merge engines and new ownership rules, and the workspace log already reaches each device, the phone too.

Event types (v1):
| Type | Writer | Data |
|---|---|---|
| `source.configured` | person | the whole source config; the newest wins |
| `inbox.run_requested` | person | `source` |
| `inbox.card_added` | collecting awd | card id, source, conversation, thread, key, project, category, urgency, title, summary, task suggestion, answer suggestion, messages |
| `inbox.card_updated` | collecting awd | card id, changed fields, new messages |
| `inbox.card_set` | person | card id, any of `read`, `done`, `category` |
| `inbox.card_project` | person | card id, `project` (a slug or null) |
| `inbox.ask` | person | card id, ask id, text |
| `inbox.answer` | collecting awd | card id, ask id, text |
| `inbox.reply_requested` | person | card id, reply id, text, `in_thread` |
| `inbox.reply_result` | collecting awd | card id, reply id, `sent` or `failed`, post id, url, error |
| `inbox.task_created` | person | card id, task id |

Fold rules: a person event needs a human `by`; an awd event needs a non-human `by`. An awd event (`card_added`, `card_updated`, `answer`, `reply_result`) needs the device that collects the source at that point of the merge order (`not_collector`). The newest value of each field wins in merge order, with one exception: after a person sets the category or the project of a card, a later `card_updated` of the agent does not change that field (the person decides). The project has its own event, because the Kotlin client can not leave out a field that can be null: so a read or a done never writes a project. A task suggestion with no project, or with the old project, follows the project of the person. New messages set `unread: true` and `done: false`. A message id is kept once per card. Each message text is at most 8,000 characters; a card has at most 200 messages. A log line is at most 64 KiB, so the collecting awd splits the messages of a big card into one `inbox.card_added` and more `inbox.card_updated` lines.

### 4. One collecting device
`source.configured.collector` names one computer. Each awd folds the newest config; only the awd of that device runs the collector and the triage session. A move to another device stops them on the old device at its next merge. The new collector starts from "now minus 1 day" and skips each message id that a card already has. The cursor (the newest `update_at` per conversation) is device-local in `~/.aw/inbox/<workspace>/cursor.json`.

### 5. Read levels
Per conversation: `all`, `mentions` (each message of a direct message or group, a message with `@<username>`, a reply in a thread whose root the person wrote), `off`. A new conversation gets `default_read` (default `mentions`). The person's own posts, system posts and deleted posts are skipped.

### 6. The triage session
- One Claude Code session per workspace on the collecting device, in the session host tmux (window `aw-triage`), with its own folder `~/.aw/inbox/<workspace>/triage/` and its own Claude session id. It is not a task and has no task log.
- The session reads text of other people, so it starts as a session of untrusted input (adapter `LaunchInput.untrusted`): `--setting-sources project` (no user settings: no user allow rule, plugin or hook), no AW plugin, `--strict-mcp-config` with a configuration of the AW server only, `--tools Read,Glob,Grep`, the allow rules `mcp__aw__*` and `Read(//<knowledge>/**)` (no `--add-dir`: Claude Code asks the person to trust an added folder, and nobody answers in this session), and `--permission-mode dontAsk`: a tool that is not allowed is refused at once and never waits for a person.
- awd mints a triage MCP token (kind `triage`). The token opens only the triage tools: `inbox_batch`, `card_add`, `card_update`, `inbox_answer`, `inbox_done`. A task token cannot call them, and the triage token cannot call task tools.
- The launch has `AW_MCP_URL` and `AW_MCP_TOKEN` and no `AW_HOOK`, so the hooks of the AW plugin do nothing.
- awd sends one item at a time as a short input line: `[AW triage batch <id>]` or `[AW inbox ask <id> card <card id>] <card title>: <text>`. The batch messages are never typed into the terminal: the agent reads them with `inbox_batch`, as YAML in a fence, with hostile-text rules (no triple backticks, no control characters, cut at 8,000 characters).
- The item is done at `inbox_done` (a batch) or `inbox_answer` (an ask). After 10 minutes with no end, awd sends it once more; after a second timeout it marks the triage state `waiting` in device health and tries at the next schedule. A usage limit gives this path.
- awd does not watch an idle pane. The next item starts a dead session again with `--resume <claude session id>`. When an item times out twice and the pane does not run, the resume failed: the next item starts a new session.
- The model is the `--model` launch flag (default `haiku`). The schedule: every 15 min, Monday to Friday, 08:00 to 20:00 by default; "Run now" ignores the schedule.

### 7. Replies are idempotent
The reply id is the Mattermost `pending_post_id`. Before a post, the collector checks its local sent file; after an error or a restart it calls `findPending` on the newest posts of the channel. A device that becomes the collecting device calls `findPending` first for each reply that waits, because the old device can have posted it. A reply is posted only from a person event, and only once. A card has one reply in `requested` at a time: a second reply is refused until the first one is sent or failed.

### 8. Tasks from a card
A card gives one task: a second "Create task" is refused when the card has a task, or when a task has the link of the card (its `inbox.task_created` can be missing). "Create task" uses the task create service with the project of the form (required), the title and the first message of the suggestion, and the link `inbox:<card id>`. Then awd writes `inbox.task_created`. A card with no project asks for a project.

### 9. UI
- Desktop: the Inbox is one list (category icon in a fixed 24 px box, unread dot, title, project · conversation, urgency bars, time) with the filter bar (category chips, project filter of `tasks-view`, Unread, Done, sort). A card opens in a dialog: title, category menu, urgency, project, conversation, summary, the suggestion box, the messages, the ask chat; Done and Unread in the footer; ↑/↓, j/k, r, t, d, u, Esc.
- Sources page: the Mattermost box, the triage box and the conversation table.
- Phone: Inbox list with the same filter, the card as its own screen with the same actions.
- Card rules for both apps (`cardRows`, sort, counts) in `shared/client` and Kotlin, tested with `contracts/fixtures/inbox/cards.json`.

### 10. Push
The collecting awd sends a push for an `inbox.card_added` with urgency `high`, or an update that raises the urgency to `high`: title `Inbox · <category>`, the card title.

## Risks / Trade-offs

- [The workspace log grows with message text] → Each message is in the log once; text is capped. A later change can move cards to their own log with pruning.
- [Hostile message text steers the agent] → Messages reach the agent only through `inbox_batch` in a fence; the triage tools can only write cards; a reply needs a person click.
- [The triage session uses the Claude plan] → Batches only when messages wait, in work hours, default model Haiku.
- [Two computers collect after a config race] → The newest config wins on each device at the next merge; dedupe by message id stops double cards.
- [The token is a long-lived secret] → It is an AW credential, encrypted, on computers only.

## Migration Plan

No migration. Old devices ignore the new event types (`unknown_type`). The release is a major version together with `nav-tasks-needs-you`.

## Open Questions

- Desktop native notifications for high-urgency cards: later, with the signed app.
