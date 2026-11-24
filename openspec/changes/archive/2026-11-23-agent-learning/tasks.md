## 1. Contract

- [x] 1.1 Add the optional fields `path`, `change` and `suggestion` to `task.learned` in `shared/schema/src/events.ts`; run `pnpm schema:generate`.
- [x] 1.2 Add `nothing_new` to `kbLearnBody` (title and content optional), and the reply `learnResultView` with `task_event` in `shared/client/src/knowledge.ts`; `KnowledgeClient.learn` uses it.

## 2. awd service, API, CLI and MCP

- [x] 2.1 Add `WorkspaceService.writeLearned` and `recordLearning` in `daemon/src/service/learning.ts` (input check, caller check, knowledge write, `task.learned`).
- [x] 2.2 The route `POST /knowledge/learn` calls `recordLearning`; run `pnpm api:generate`.
- [x] 2.3 `aw learn --nothing-new` with the exit 2 rules, the print text and exit 1 for an event that is not applied.
- [x] 2.4 The MCP tool `learn` takes `nothing_new`; title and content optional; the instructions name the 2 knowledge rules (below 4,096 characters).
- [x] 2.5 `aw thread` text of `task.learned`.

## 3. Task paths and the session context

- [x] 3.1 `namedPaths` in `plugins/kb-files/src/context.ts`; `buildContext` adds the paths named in the title and the first message.
- [x] 3.2 `daemon/src/sessions/task-paths.ts`: the changed files of a worktree (git status, git diff against the checkout HEAD).
- [x] 3.3 `SessionManager.#knowledge` passes the task paths (approach text and changed files); `sessionContext` has the 2 knowledge rule lines.

## 4. Done reminder

- [x] 4.1 The "Result approved" notice names `aw learn … --nothing-new`; the `done` reply adds the reminder when the task has no `task.learned`.
- [x] 4.2 `WorkLoop.stopped` writes the reminder comment once when a done task has no applied `task.learned`.

## 5. Agent plugin

- [x] 5.1 Add `learn`, `kb write`, `kb search`, `kb show`, `kb list`, `kb context` to `AGENT_COMMANDS`.
- [x] 5.2 SKILL.md rules 10 and 11 and the `aw learn --nothing-new` command; below 6,000 characters.

## 6. Desktop

- [x] 6.1 `LearnedLine` component in the thread with Undo; `systemLine` text of `task.learned`.

## 7. Docs

- [x] 7.1 `docs/workflow.md` 4.10 and 8, `docs/phase-1.md` 5.9 and 9.1.6, `docs/architecture.md` 4.8.3.

## 8. Tests and evidence

- [x] 8.1 Unit tests: service, CLI, MCP, context paths, task paths with git, allow rules, SKILL.md, thread texts (CLI and desktop), done comment. Break each once.
- [x] 8.2 e2e with tmux and the fake agent: `daemon/src/loop/learn.e2e.test.ts` (Read now, MCP nothing-new, done, CLI fallback with no gate, reminder comment).
- [x] 8.3 Journey with awd in a terminal and the fake agent; desktop screenshot of the thread.
- [x] 8.4 Real Claude Code (haiku) run on the Linux test server.
- [x] 8.5 `task check` in each changed folder; `task leakcheck`.
