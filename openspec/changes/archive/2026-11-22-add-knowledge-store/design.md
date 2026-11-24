## Context

- `docs/phase-1.md` 5 and `docs/architecture.md` 4.8 describe the knowledge store: Markdown files in the synced folder `knowledge/`, a change log per device, a content-addressed history store outside the synced folder, Undo, learned entries, approval and a daily digest.
- `docs/decisions/2026-11-22-device-sync.md` rule 6: the priority rule overwrites the other version with no visible backup; Undo uses the hidden history on each computer; agents write each learned item to a new file.
- The data model has `knowledge.changed {path, hash, base, author, task, kind}` and `knowledge.undo_requested`. The files layer knows the paths `knowledge/log/<device>.jsonl` (writer: that device) and `knowledge/(shared|projects/<p>)/…` (shared file). The merge engine does not read the knowledge logs.
- awd (`daemon/`) has one `WorkspaceService` per workspace with the files layer, the merge engine and the index, a watcher on `tasks/`, the local API and the `aw` CLI. Three tasks run in parallel (sessions-tmux, sync-syncthing, knowledge), so the changes in `daemon/` stay small and in new files.

## Goals / Non-Goals

**Goals:**
- One `KnowledgeStore` implementation on plain files with history and Undo for local writes, direct human edits and changes that sync brought from another device.
- Learned entries, approval suggestions with accept and reject, a digest projection, search, and the context of a session.
- No credential value in a knowledge file, a history version that AW writes, or a change event.
- awd routes and `aw` commands for each operation.

**Non-Goals:**
- The `approve_knowledge` gate in a task and its push rules (task-loop). The suggestion record is the data that the gate shows.
- The MCP `learn` tool, `aw learn --nothing-new` and `task.learned` (mcp-server, task-loop).
- The phone path: `knowledge.undo_requested` and its resolver device (desktop-devices-kb, android-ui).
- The conflict resolver of Syncthing copies (sync-syncthing). It calls `write({kind: "replaced"})` of this store.
- The copy of the history store at pairing (identity-pairing) and `aw kb export --git`.
- Vector or graph search (P3).

## Decisions

### 1. Paths are relative to `knowledge/`
A knowledge path is `shared/…` or `projects/<project>/…`, the same form as the `path` of `knowledge.changed` in the fixtures. The store adds `knowledge/` for the files layer. A path outside these 2 scopes, a temp name, a conflict copy and the `log/` folder are not knowledge files; `list` and `reconcile` skip them, and `write` refuses them (`WriteRefusedError` of the files layer).

### 2. Front matter in each file, no metadata file
The YAML front matter between the first 2 `---` lines holds:
- `apply`: `always`, `auto`, `files` or `manual`.
- `description`: for Auto.
- `globs`: a list for Files.
- `locked`: a boolean.
- `source`, `author`, `task`, `learned_at`, `validated_at`: the provenance.

Unknown fields stay. The default apply mode is `always` for a file in `rules/` directly under the scope (`shared/rules/…`, `projects/<p>/rules/…`), else `auto`. A front matter that is not a YAML map or has a wrong field type gives the defaults and a `front_matter_error` in the list. A bad file must not hide the other files. The zod schema is in `plugins/kb-files` (open issue: move it to `shared/schema` when the Android app reads knowledge).

### 3. History store and `seen.json`
- `<AW_HOME>/history/<workspace id>/<sha256>` holds each version, keyed by the sha256 of its bytes. The folder has mode 0700 and each file 0600. It is written atomically, and only once.
- `get(hash)` checks the hash. A changed file gives "not available", never wrong content.
- `<AW_HOME>/history/<workspace id>/seen.json` keeps the hash, the size and the mtime of each path that this device saw last. It is local state, written atomically after each change.
- Alternative rejected: the SQLite index for `seen`. The index can be rebuilt from the synced files, but `seen` cannot (it is what this device saw). A separate file keeps that rule clear.

### 4. One change path for each source
`#apply({path, content|null, base?, author, task, kind, by, suggestion?})`:
1. Read the current file. Store its version (copy before write).
2. Check `base` when it is given: `null` means "the file must not exist". A different hash gives `KnowledgeConflictError` (409 `conflict`, with the current hash).
3. Redact the content, then hash it and store it.
4. Write the file with `files.writeFile`, or remove it with `files.removeKnowledgeFile` for `content: null`.
5. Update `seen`, append `knowledge.changed` with `by`, and save `seen`.

A content equal to the current file writes nothing and returns `unchanged: true`. All store operations run one at a time (a stored promise chain in the store), like the merge engine.

### 5. Detect direct edits and sync changes: `reconcile()`
The store walks the knowledge folder and compares each file with `seen`. It skips a file whose size and mtime did not change. For a changed file with hash `D`, where `S` is the hash in `seen`:
- It always stores `D` in the history, so an Undo of a remote change has its base.
- `D` is explained when the newest merged event of the path has hash `D`, or an event of another device has `base = S` and `hash = D`. A transition of this device does not count: a person can make the same edit again by hand (the e2e test found this case). Then it is a sync change or an own write: only `seen` changes. The author device logged it (`docs/phase-1.md` 5.2).
- An unexplained hash waits for the settle time (`SETTLE_MS` = 2 s on the clock module). The sync can deliver the file before its log line. When it is still unexplained after the wait, the store logs `knowledge.changed {kind: "edit", author: human@<device>, base: S}`.
- A path in `seen` that is missing on disk is a sync delete when the newest event of the path has `hash: null`. Else, after the settle time, it is a human delete (`kind: "delete"`).
- `reconcile()` returns the logged changes and `next_check_at` while a path waits. awd calls it at the start, after each watcher batch, and at `next_check_at`.
- Alternatives rejected:
  - A file watcher only: it misses the edits made while awd was stopped.
  - Syncthing events only: they do not exist yet in this task. Later, sync-syncthing can call `reconcile` with the paths of `RemoteChangeDetected` (open issue).

### 6. Read the knowledge logs in the store
The store reads `knowledge/log/*.jsonl` with `files.readEvents`, keeps a cache per file by size and mtime, and sorts the events with `compareOrder` (HLC, device, id). It gives each HLC within 24 h of the clock (`DEFAULT_MAX_SKEW_MS`) to `files.hlc.observe()`, so an Undo sorts after the change that it undoes. Alternative rejected: add the knowledge logs to the merge engine. The engine and the index belong to merge-index, and the knowledge view has no ownership rules.

### 7. Undo
`undo(change, by)` finds the change event by its id. It restores the `base` content of the change from the history store: `null` removes the file. It writes the restore as a new change of kind `undo`, with the current hash as its base. A missing base version gives `not_found` ("The version <hash> is not in the history store of this device"). A file that already has the base content gives `unchanged`. An Undo by an agent follows the approval rules (decision 9).

### 8. Learned entries
`learn({project, task, task_key, author, title, content, shared?, from_person?})` writes a new file `projects/<project>/learned/<YYYY-MM-DD>-<slug>.md`, or `shared/learned/…` with `shared`. The UTC date comes from the clock. The slug comes from the title (lower case, `-`, at most 60 characters). The store adds `-2`, `-3`, … when the name exists. The store merges its provenance into the front matter: `source: <author> on <key>` (the fixture form), `author`, `task`, `learned_at`, and `apply: auto` and `description: <title>` when they are missing. It adds `# <title>` when the body has no first-level heading. The change kind is `learned` and the base is `null`. A change entry has the label "Learned by claude@ubuntu-01 on AW-7"; the store gets the task key from a `taskKey(id)` function of awd.

### 9. Approval rules and suggestions
`approvalReasons(change)` is a pure function. It gives no reason for an author `human@…` or `aw@…`. For any other author (an agent), it gives:
- `rule`: the path is in `rules/` of a scope.
- `locked`: the current file has `locked: true`.
- `shared`: the path is in `shared/`.
- `other_person`: the change comes from the message of another person (`from_person`, P2 signals).

When a reason exists, the store writes no file. It appends `knowledge.suggested {suggestion, path, content, hash, base, author, task, kind, reasons}` to its knowledge log. The content is in the event, so the phone and each device can show it with no new folder. The content is redacted and at most 48 KiB (a log line is at most 64 KiB).
- A human accepts (`accept(id, {by, force})`): the store applies the content through decision 4, with the suggestion `author`, the human as `by` and `suggestion: <id>` in `knowledge.changed`. Then it appends `knowledge.suggestion_resolved {suggestion, decision: "accepted", comment}`. When the file changed after the suggestion (current hash ≠ base), accept gives 409 `conflict` unless `force` is true.
- A human rejects: only the `resolved` event.
- A suggestion is pending while no `resolved` event and no `knowledge.changed` with its id exist. So a crash between the 2 writes leaves it accepted, not pending. The first resolution in merge order wins; a later one is ignored and reported in the suggestion as `late_resolutions`. One exception: a `knowledge.changed` that applied the suggestion makes it accepted in any order, because the file has the content and its Undo is in the history.
- Alternative rejected: a suggestion file in a new folder (`knowledge/suggestions/`). It is a new layout rule and a second write path, and the event already syncs to all devices.

### 10. Digest projection
`digest(date)` gives `{date, learned, changes, pending, text}` for a UTC date:
- `learned`: the agent changes of kind `learned` on that date, each with its change id for Undo.
- `changes`: the other agent changes.
- `pending`: all pending suggestions.
- Text: "Agents learned 4 things. 1 change waits for approval." With no entry: "Agents learned nothing new."

When the Inbox shows it is the job of the desktop task. `croner` is not needed now.

### 11. Context builder
`buildContext({files, task, root, budget})` is a pure function. Selection:
- **Read now**: rules and `always`; `manual` when the title or the first message names its path; `files` when a task path matches a glob (`node:path` `matchesGlob`).
- **Read when relevant**: `auto`, with the description.
- **Read before you change matching files**: `files` with no match, with the globs.
- Not listed: `manual` with no mention (only a count).

Budget: the sum of the sizes of the "Read now" files is at most `load_limit` (default 40,000 characters). The store keeps files in this order: project rules, shared rules, project `always`, shared `always`, named `manual`, matched `files`. A file that does not fit is dropped, and a warning names it, its size and the limit. The text names the dropped files too. The text is at most `TEXT_LIMIT` = 9,000 characters, below the 10,000-character hook limit with room for the task fields. When the list is too long, the last "relevant" lines go first, with a warning and the line "N more files: run `aw kb list`". The text has a short header, the folder path, the budget line and the lists. The agent reads the files itself. Project scope = the project of the task; shared applies to each task.

### 12. Redaction
The store has `setSecrets(secrets)` with the `createRedactor` of `@aw/core`.
- A content that AW writes (write, learn, suggestion, accept) is redacted before its hash.
- A direct human edit that holds a secret: the store writes the redacted text back (a change of kind `edit` by the human author), and it stores and logs only the redacted version.
- Events go through `files.appendEvent`, which redacts the free text of each event. awd has no credential values yet (identity-pairing), so awd sets none. The tests give secrets.

### 13. Delete in the files layer
`WorkspaceFiles.removeKnowledgeFile(path)` removes only a path of the rule `knowledge-file`, after the guard. It is the second delete of the files layer. The `workspace-files` spec changes for it.

### 14. awd wiring in new files
- `daemon/src/service/knowledge.ts`: `KnowledgeService` per workspace. It holds the store, the watcher on `knowledge/` (`@parcel/watcher`, batch of 100 ms, then the settle timer on the clock) and the actor rules: the API writes as `human@<device>`; `learn` takes an optional `author` of the form `<agent>@<this device>`.
- `WorkspaceService` makes it in `open()`, starts it in `watch()` and closes it in `close()` (about 10 lines).
- `daemon/src/api/knowledge.ts`: the routes under `/v1/workspaces/{ws}/knowledge` (tag `knowledge`). One line in `app.ts` registers them.
- `daemon/src/cli/kb.ts`: `aw kb …` and `aw learn`. One line in `run.ts` adds them.
- `shared/client/src/knowledge.ts`: the zod schemas (also re-exported by `@aw/client/schemas`) and `KnowledgeClient` on `AwClient.request`.

### 15. Libraries
- `diff` 9.0.0 (`createTwoFilesPatch`) makes the diff of a history entry. The repository already has a row for it (desktop), and the same library serves both.
- `yaml` 2.9.1 parses the front matter.
- No glob library: Node 24 `path.matchesGlob` prints no warning on 24.22.3.
- Search is a plain term match: all terms in the path or the text, the score is the count, and the snippet is the first match line. A search index waits for P3.

## Risks / Trade-offs

- [A remote file arrives more than 2 s before its log line] → The store logs it as a human edit of this device: a visible extra change, not a loss. Mitigation later: sync-syncthing gives `RemoteChangeDetected` paths (open issue).
- [Crash between the file write and the event] → The next `reconcile` logs the file as a human edit of this device. The history keeps the version, and the change is visible.
- [A human types a secret into a knowledge file] → AW rewrites it at once, but Syncthing can send the raw text before the rewrite (`fsWatcherDelayS 1`). Open issue for sync-syncthing: a short hold on knowledge scans, or a redaction before the scan.
- [Large knowledge folder] → `reconcile` skips unchanged files by size and mtime; the log cache reads only changed log files.
- [Schema change while 2 other tasks run] → The generated files (`contracts/`, Kotlin) can conflict at integration. The lead runs `pnpm schema:generate` and `pnpm api:generate` after the merge.

## Migration Plan

No stored data exists. Rollback: revert the commit and run `pnpm schema:generate` and `pnpm api:generate`.

## Open Questions

- None that block. The open issues are in the result handoff.
