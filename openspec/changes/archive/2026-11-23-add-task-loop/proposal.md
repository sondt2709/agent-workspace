## Why

The sessions, the gates from hooks and the MCP server exist, but no code moves a task through the stages of `docs/workflow.md`. The tools `approach`, `ready`, `task_create`, `gate`, `result` and `done` answer `not_available`, no device sends a push, and a subtask cannot start. This change builds the full work loop of phase 1: Discuss → Ready → Implement → Review → Done, independent of any agent workflow.

## What Changes

- **Stage effects on the session device:** first claim → Discuss (a subtask with a confirmed parent approach → Ready); "Confirm" of "Confirm approach" → Ready; the ready checks pass → Implement and the notice "Start implementing"; `result` → Review with the gate "Approve result"; "Request changes" of a result → Implement in the same session; "Approve" → the notice "Result approved", then Done at the first Stop or at `done`, and AW closes the window.
- **Approach versions:** `approach` writes `approach/v<n>.md` once, `approach.proposed` and the gate "Confirm approach" with the Markdown and optional decisions with a recommendation.
- **Ready checks:** `ready` (with `missing` items as question gates); checks of the implementing device: a ready of this session with no open missing item, a confirmed approach (or the parent approach for a subtask), an assignee, done dependencies, and the `knowledge` and `secure` folders in sync with each connected peer ("Waiting for sync: knowledge 92 %", a `waiting_for_sync` pause).
- **Subtasks:** `task_create` and `aw task create` in a session: a subtask of the session task, copy fields from the parent (`from_parent`: test server, credential names, links), no assignee ("Needs you: assign") unless the project switch is on. A subtask starts only when its dependencies are done. The parent session gets "Subtask AW-13 done"; when the parent session ended, AW starts a new one with the notice as the first input.
- **Merge fix:** the project switch "Assign new subtasks to the default device" sets only the FIRST assignment (TypeScript and Kotlin).
- **Gates:** `gate` opens a custom gate with Markdown and decisions. Knowledge suggestions of a task open "Approve knowledge change"; its answer accepts or rejects the suggestion. Push and reminders follow the gate table (1 h and 24 h; 24 h for "Assign task" and "Fix a file").
- **Notices:** a text of AW to the session is a `message.sent` by `aw@<device>`, delivered with the prefix `[AW notice <id>]`; `message.human` gets the source `notice`.
- **Web Push sender** (`plugins/push-webpush`): VAPID key per computer (RFC 8292), `aes128gcm` encryption (RFC 8291, with the RFC test vectors), send to each phone subscription of `push.yaml` with the own computer slug and the current key. Schema: `vapid_public_key` in `bindings.v1`, new document `push.v1`.
- **Credentials at session start:** a `CredentialProvider` interface; the values go to the session as 0600 files (`AW_CREDENTIALS_DIR`). The identity-pairing integration fills the provider.
- **Agent interface:** MCP tools `approach`, `ready`, `task_create`, `gate`, `result`, `done`; commands `aw approach|ready|result|done`, `aw gate open`, `aw task create` in a session; local API session routes; the new commands in the allow rules.

## Capabilities

### New Capabilities
- `task-loop`: stage effects, approach versions, ready checks, subtasks, notices, gate push and reminders, knowledge gates, credentials at session start.
- `push-sender`: the Web Push sender (VAPID, RFC 8291 encryption, subscriptions of `push.yaml`).

### Modified Capabilities
- `workspace-merge`: the project switch sets only the first assignment.
- `workspace-schemas`: `vapid_public_key` in bindings, `push.v1`, `task.ready.gates`, `gate.opened.decisions`, the `notice` source of `message.human`.
- `mcp-server`: the loop tools are built (no `not_available` for them).
- `aw-cli`: the new agent commands.
- `local-api`: the new session routes.

## Impact

- Code: `daemon/src/loop/` (new), small hooks in `daemon/src/sessions/manager.ts`, `daemon/src/mcp/tools.ts`, `daemon/src/api/sessions.ts`, `daemon/src/cli/agent.ts`, `daemon/src/cli/run.ts`; `plugins/push-webpush`; `shared/schema`; `shared/core/src/merge/task.ts`; `shared/client`; `plugins/agent-claude` (allow rules, skill); Kotlin `TaskFold.kt`, `DocumentReader.kt`.
- Generated: `contracts/schemas`, `contracts/samples`, Kotlin classes, `contracts/openapi.yaml`, merge fixture `task-rules`.
- Dependencies: `@noble/curves`, `@noble/hashes`, `@noble/ciphers` 2.4.0 (already in `docs/tech-stack.md`).
- Docs: `docs/workflow.md` 3, 4.7, 8; `docs/phase-1.md` 8, 9.5, 9.8; `AGENTS.md` status.
