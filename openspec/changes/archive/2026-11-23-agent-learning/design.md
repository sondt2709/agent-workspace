## Context

The knowledge store (`plugins/kb-files`) writes learned files, and the merge folds `task.learned` into `TaskView.learned`. No code writes `task.learned`. A learned file goes only to the knowledge log, so the task thread does not show it. The session context calls `knowledge.context(task, {})` with no task paths, so a file with `apply: files` never reaches "Read now". The allow rules of a session do not cover `aw learn` or the `aw kb` commands, so the CLI fallback opens "Approve command" (evidence: `base-cli-fallback-7dcbe93.log`).

## Goals / Non-Goals

**Goals:**
- One awd method records the learning step for the CLI, the MCP tool and the local API.
- The person sees the learning step on the task: `aw thread`, the desktop thread.
- "Read now" gets the `files` files that match the paths of the task.
- The agent gets 2 rules: search the knowledge first; learn or "Nothing new" before `done`.

**Non-Goals:**
- The knowledge features of gap N9 (scope moves, `validated_at`, user-level rules, export).
- Knowledge Undo on the phone (N3), and the phone thread text of `task.learned` (`android/` is out of scope of this change).
- A block of `done` with no learning step.

## Decisions

1. **One service method in a new file.** `recordLearning(service, input, caller)` in `daemon/src/service/learning.ts`. It checks the input (either `nothing_new: true`, or `title` and `content`), checks the caller with the same rules as `KnowledgeService.learn` (the session task, the author of this device), writes the knowledge file for a learned item, then writes `task.learned` through a new `WorkspaceService.writeLearned` (the queue and `#writeTaskEvent`). The route, the CLI (through the route) and the MCP tool call it. Alternative: a second route for "Nothing new". Rejected: 2 code paths for one step, and one more registration line in a shared file.

2. **A learned item also writes `task.learned`.** Data: `{nothing_new: false, path, change, suggestion}`. `change` is the knowledge change id, `suggestion` the suggestion id when the item waits for approval (`shared: true`). The thread is the task log, so this is how the task shows what the agent learned (`docs/architecture.md` 4.8.3: "The thread shows 'Learned by …'"). Alternative: merge the knowledge log rows into the thread. Rejected: 2 logs in one thread page, and the phone would need the same code.

3. **Schema: optional fields.** `task.learned` keeps `nothing_new` (required) and adds optional `path` (relative path), `change` and `suggestion` (UUIDv7 or null). Old events stay valid. `pnpm schema:generate` regenerates `contracts/schemas`, `contracts/samples` and the generated Kotlin class (no hand edit in `android/`).

4. **The reply keeps `KnowledgeChangeResult` and adds `task_event`.** `{id, applied, reason}` of the `task.learned` event, or null when the knowledge write did not happen. For "Nothing new", `change` and `suggestion` are null and `unchanged` is false. The CLI prints the reason and exits 1 when the merge did not apply the event (the same rule as the other writes).

5. **Who can write it.** `task.learned` counts only from the owner device (merge rule `STATE_EVENTS`). The agent of the session writes it on its device. The person can run `aw learn <task> --nothing-new` on the owner device. On another device the event is not applied, and the CLI says so.

6. **Task paths.** "Task path" = a path named in the task text, or a file that the work branch changed.
   - `plugins/kb-files` `buildContext` adds `namedPaths(title + first message)` to the given paths. So `aw kb context <task>` with no `--path` and the session context agree. `namedPaths` takes tokens with a `/` or a file extension (`src/api/invoice.ts`, `README.md`), drops URLs (`://`), `./` and the quotes and punctuation around a token, and keeps at most 200.
   - The session manager adds `namedPaths(confirmed approach)` and the changed files of the worktree: `git status --porcelain -z --untracked-files=all` and `git diff --name-only -z <checkout HEAD>...HEAD`, at most 500 paths, 5 s timeout, errors give no paths (`daemon/src/sessions/task-paths.ts`). A new session in a new worktree has no changed files; a resume and a moved task have them.
   - Alternative: a `paths` field on the task. Rejected: a schema and UI change, and the person must type paths.

7. **Allow rules.** `AGENT_COMMANDS` adds `learn`, `kb write`, `kb search`, `kb show`, `kb list` and `kb context`. `kb accept`, `kb reject` stay in `HUMAN_COMMANDS`. `kb undo` and `kb history` stay out (Undo asks the human). awd already refuses a session write to `shared/` or a rule, and the token sets the author.

8. **Done with no learning step.** The docs say what the agent must do (D3, KB-05), not that AW blocks `done`. AW does not block. The "Result approved" notice names `learn` and "Nothing new". The `done` reply adds "You recorded no learning step: run learn now, before you end your turn" when the task has no `task.learned`. At the done Stop (`WorkLoop.stopped`), when the task still has no applied `task.learned`, AW writes `comment.added` by `aw@<device>`: "AW-1 is done with no learned item and no 'Nothing new' (decision D3)." The step key `done-learn` writes it once.

9. **Thread text.** `aw thread`: "Nothing new learned" or "Learned: <path>" (with "waits for approval" for a suggestion). Desktop: a new `LearnedLine` component shows "Learned by <by>: <path>" with an Undo button (the existing `kbUndo` call) for a change, and "Nothing new learned by <by>".

## Risks / Trade-offs

- [The agent ignores the skill rule] → The `done` reply and the notice remind it; the comment shows the gap to the person. The real haiku run records the result.
- [A false path from the task text] → It only matters when a `files` glob matches it; the file is then in "Read now", which costs budget but loses nothing.
- [`git diff` on a large repository] → 5 s timeout and at most 500 paths; a failure gives no paths and a log line.
- [The allow rule `Bash(aw kb write *)` lets an agent write a project file with no prompt] → The same as the MCP `learn`: the author is the agent, a locked file waits for approval, `shared/` and rules are refused. The knowledge history keeps each version (Undo).

## Migration Plan

None. Old `task.learned` events (`{nothing_new: true}`) stay valid. Old clients send no `nothing_new`.

## Open Questions

None.
