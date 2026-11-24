## MODIFIED Requirements

### Requirement: SessionStart context
awd SHALL write `context.md` of the session before each window open (new and resume): the task fields, the open gates, the AW rules, and the text of the knowledge context builder of the knowledge store for the task (`KnowledgeService.context`) with the task paths. The task paths SHALL be the paths named in the confirmed approach and the changed files of the session worktree (`git status` and `git diff --name-only <checkout HEAD>...HEAD`, at most 500, a failure gives none). The AW rules SHALL say to search the knowledge first and to record `aw learn` or `aw learn <key> --nothing-new` before `aw done`. The file SHALL have at most 10,000 characters; a knowledge list that does not fit SHALL be cut at a line end and end with "run `aw kb context <key>`" and the thread line. When the knowledge store gives no context, the file SHALL name the cause. The SessionStart hook SHALL give the file to the agent.

#### Scenario: Knowledge of the project
- **WHEN** the knowledge has the rule `shared/rules/style.md`, the `auto` file `projects/billing-api/invoices.md` and a file of another project, and a session of a billing-api task starts
- **THEN** `context.md` lists the rule under "Read now", the invoices file with its description under "Read when relevant", and not the file of the other project, and the agent gets the whole file

#### Scenario: Files knowledge of a task path
- **WHEN** the knowledge has `projects/billing-api/invoice-api.md` with `apply: files` and `globs: ["src/api/**"]`, and the first message of the task names `src/api/invoice.ts`
- **THEN** `context.md` lists `invoice-api.md` under "Read now"

#### Scenario: Changed file of a resumed session
- **WHEN** the worktree of the session has a new file `src/api/tax.ts`, and the session resumes
- **THEN** `context.md` lists the `files` file with the glob `src/api/**` under "Read now"
