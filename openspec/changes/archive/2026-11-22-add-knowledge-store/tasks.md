## 1. Contracts

- [x] 1.1 Add `knowledge.suggested`, `knowledge.suggestion_resolved` and the optional `suggestion` field of `knowledge.changed` to `shared/schema/src/events.ts`, with valid and invalid samples; run `pnpm schema:generate`
- [x] 1.2 Add `WorkspaceFiles.removeKnowledgeFile(path)` to `shared/core` with tests (own knowledge file, knowledge log, other path)
- [x] 1.3 Add the `KnowledgeStore` interface and its types to `shared/plugin-api`

## 2. kb-files plugin

- [x] 2.1 Front matter parse and render (defaults, rules folder, bad front matter, unknown fields kept)
- [x] 2.2 History store (content addressed, modes, hash check) and `seen.json`
- [x] 2.3 Change log reader with the cache, the merge order and the HLC observe
- [x] 2.4 `FileKnowledgeStore`: list, read, write with base, the serial queue, redaction
- [x] 2.5 `reconcile()`: direct edit, direct delete, sync change, settle time, redaction of a direct edit
- [x] 2.6 History with diffs, Undo (local edit, remote change, learned file)
- [x] 2.7 Learned entries, approval rules, suggestions, accept and reject
- [x] 2.8 Digest projection and search
- [x] 2.9 Context builder (modes, budget, warnings, text limit)

## 3. awd and client

- [x] 3.1 `KnowledgeService` with the watcher and the settle timer; wiring in `WorkspaceService`
- [x] 3.2 Client schemas and `KnowledgeClient` in `shared/client`
- [x] 3.3 Knowledge routes in `daemon/src/api/knowledge.ts`; `pnpm api:generate`
- [x] 3.4 `aw kb` and `aw learn` commands in `daemon/src/cli/kb.ts`
- [x] 3.5 Route and CLI tests; e2e with awd as a child process (API write, direct edit on disk, undo both, files, history store, change log)

## 4. Docs and checks

- [x] 4.1 Update `docs/phase-1.md` 3.1, 3.2.4, 5; `docs/architecture.md` 4.8; `docs/workflow.md` 8; `docs/tech-stack.md` (`diff` row); `AGENTS.md` status
- [x] 4.2 `task check` passes; break each new test once (mutation script in the evidence folder)
