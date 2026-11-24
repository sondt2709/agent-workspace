## Why

Principle 3 says that agents get knowledge and keep it, with a full history, Undo and a backup. AW has the `knowledge` folder and the `knowledge.changed` event type, but no code reads or writes knowledge. The tasks after this one (mcp-server `learn`, task-loop approval gate, desktop knowledge screens) need one store with history and Undo first.

## What Changes

- `shared/plugin-api` gets the `KnowledgeStore` interface (`docs/architecture.md` 6.2): `list`, `read` (with a version), `write` (with base, author, task and kind), `history`, `undo`, `search`, and the types of files, changes, history entries, suggestions and the context.
- New plugin code in `plugins/kb-files` (`FileKnowledgeStore`):
  - Knowledge files in `knowledge/shared/` and `knowledge/projects/<project>/`, with front matter (apply mode, description, globs, lock, provenance).
  - A content-addressed history store outside the synced folder (`~/.aw/history/<workspace>/<sha256>`) with copy before write, and a local `seen.json` with the last hash of each path that this device saw.
  - The change log `knowledge/log/<device>.jsonl` (`knowledge.changed` with path, hash, base, author, task, kind).
  - `reconcile()` finds direct human edits and deletes on disk and logs them, and stores each version that sync brought from another device. So Undo works for local edits and for changes from other devices.
  - Undo writes the base content as a new change of kind `undo`. The Undo of a learned file removes the file.
  - Learned entries: one new file per learned item (`projects/<project>/learned/<date>-<slug>.md`) with the provenance "Learned by claude@ubuntu-01 on AW-7".
  - Approval rules: an agent change to a rule, a locked file or shared knowledge, or knowledge from the message of another person, becomes a suggestion record. A human accepts or rejects it.
  - A daily digest projection ("Agents learned 4 things. 1 change waits for approval.").
  - The context builder selects files by scope and apply mode (Always, Auto, Files glob, Manual), reports the size budget, warns before it drops a file, and returns a short context text (below the 10,000-character hook limit) with a file list.
  - Redaction: knowledge files and their change events never hold a credential value.
- `shared/schema`: new event types `knowledge.suggested` and `knowledge.suggestion_resolved`, and an optional `suggestion` field in `knowledge.changed` (a minor change). `contracts/schemas`, `contracts/samples` and the Kotlin classes are generated again.
- `shared/core`: `WorkspaceFiles.removeKnowledgeFile(path)`, the second delete of the files layer, only for the `knowledge-file` rule.
- awd: a `KnowledgeService` per workspace, a watcher on `knowledge/`, local API routes under `/v1/workspaces/{ws}/knowledge/...`, and `aw kb` commands (`list`, `show`, `write`, `history`, `undo`, `search`, `suggestions`, `accept`, `reject`, `digest`, `context`), plus `aw learn <task> --file`.
- `@aw/client`: the knowledge schemas and a `KnowledgeClient`.

## Capabilities

### New Capabilities
- `knowledge-store`: the knowledge files, front matter, history store, change log, direct edit detection, Undo, learned entries, approval suggestions, digest, search, context builder and redaction of the file store.

### Modified Capabilities
- `workspace-schemas`: the event type list gets `knowledge.suggested` and `knowledge.suggestion_resolved`.
- `workspace-files`: the write guard allows a second delete, `removeKnowledgeFile`, only for knowledge files.
- `local-api`: new knowledge routes.
- `aw-cli`: new `aw kb` and `aw learn` commands.

## Impact

- Code: `shared/plugin-api`, `plugins/kb-files`, `shared/schema` (events, samples), `shared/core` (`workspace.ts`), `shared/client` (new files), `daemon/` (new service, route and command files; small wiring changes in `workspace.ts`, `app.ts`, `run.ts`).
- Generated files: `contracts/schemas/event.v1.schema.json`, `contracts/samples/schema-samples.json`, the Kotlin event classes in `android/shared/generated/`, `contracts/openapi.yaml`. Undo: revert the schema change and run `pnpm schema:generate` and `pnpm api:generate`. `android/shared` `SchemaSamplesTest` counts 15 event samples (2 new invalid samples). The Kotlin model does not check `minItems`, so the sample uses an unknown reason, not an empty list.
- Dependencies: `diff` 9.0.0 (BSD-3-Clause, no dependencies, already a row in `docs/tech-stack.md` 2.4) in `@aw/kb-files`; `yaml` 2.9.1 (already pinned) in `@aw/kb-files`. Glob match with `node:path` `matchesGlob` (no library).
- Docs: `docs/phase-1.md` 3.1 (history folder, `seen.json`), 3.2.4 (front matter fields), 5 (detection rule, suggestions); `docs/architecture.md` 4.8; `docs/tech-stack.md` (`diff` row also for kb-files); `docs/workflow.md` 8 (`aw kb` commands).
- Not in this change: the `approve_knowledge` gate in a task (task-loop), the MCP `learn` tool and `--nothing-new` with `task.learned` (mcp-server, task-loop), the handling of `knowledge.undo_requested` from the phone, the copy of the history store at pairing, `aw kb export --git`.
