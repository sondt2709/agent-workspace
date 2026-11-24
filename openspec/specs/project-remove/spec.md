# project-remove Specification

## Purpose
The remove of a project from AW: the preview, the removal event, the merge rule for 2 devices, the stop of the sessions, the cleanup of the worktrees, branches and checkouts, the free slug and the files that stay.
## Requirements
### Requirement: Remove a project
A person SHALL remove a project with `POST /v1/workspaces/{ws}/projects/{project}/remove`, `aw project remove <slug> --yes` and "Remove the project" in Project settings of the desktop app. All 3 SHALL call one service method. awd SHALL write one event `project.removed {project, name, document}` to the workspace log of the device, by `human@<device>`, where `document` is the `project.yaml` at the remove. An unknown or removed project SHALL give 404. A session caller SHALL get 403 `refused`, and the CLI SHALL refuse the command inside an agent session.

#### Scenario: Remove with the CLI
- **WHEN** a person runs `aw project remove billing-api --yes`
- **THEN** `tasks/log/<device>.jsonl` has `project.removed` with `project: billing-api`, and `aw project list` does not list `billing-api`

#### Scenario: Session caller
- **WHEN** an agent session calls the remove route
- **THEN** awd answers 403 `refused` and writes nothing

### Requirement: Remove preview
`GET /v1/workspaces/{ws}/projects/{project}/removal` SHALL give the project, its open tasks (not done and not archived) and its running sessions with their device. `aw project remove <slug>` with no `--yes` SHALL print this preview and exit 1. The desktop dialog SHALL show the open tasks and the running sessions, and SHALL enable "Remove" only after the person types the slug.

#### Scenario: Preview names a running session
- **WHEN** task AW-3 of `billing-api` has a running session on ubuntu-01 and the person runs `aw project remove billing-api`
- **THEN** the output names AW-3 and its session on ubuntu-01, says to add `--yes`, and the exit code is 1

### Requirement: Removed project in the merge
The merge of awd and of the phone SHALL keep the removed projects and tasks out of `projects` and `tasks` of the view, and list them in `removed_projects` and `removed_tasks`. With R the newest `project.removed` of a slug, a project SHALL be live when no R exists or its `added_at` sorts after R. A task SHALL be removed when R exists and its `task.created` sorts before R, or its project is not live. A removed task SHALL not be an open dependency of another task. The merge SHALL apply `project.removed` only from a person. The next free task key SHALL count the removed tasks.

#### Scenario: Remove and new task at the same time
- **WHEN** macbook-pro removes `billing-api` and, before it syncs, ubuntu-01 creates task AW-5 in `billing-api`
- **THEN** after sync both devices show neither `billing-api` nor AW-5, and both list AW-5 in `removed_tasks`

#### Scenario: Dependency on a removed task
- **WHEN** AW-25 of `docs-site` depends on AW-23 of `web-app`, and a person removes `web-app`
- **THEN** AW-25 has no open dependency

#### Scenario: Next key after a remove
- **WHEN** the removed project had AW-1 to AW-4 and a person creates a task
- **THEN** the new task gets AW-5

### Requirement: Free slug after a remove
`addProject` SHALL refuse only a live slug. A project added with the slug of a removed project SHALL get a new `project.yaml` with `added_at` that sorts after each removal of the slug. The tasks of the removed project SHALL stay out of the views.

#### Scenario: Add the same slug with a new folder
- **WHEN** a person removes `billing-api` and adds `billing-api` again with another checkout folder
- **THEN** the add succeeds, the project shows with no task, and the binding of this device has the new folder

### Requirement: Sessions and checkouts of a removed project
Each computer SHALL stop its running sessions of the removed tasks with `session.ended` reason `stopped`, and SHALL push no wake branch. Each computer SHALL remove its own checkout of a removed slug from `bindings.yaml` when the checkout `bound_at` is null or sorts before the removal. `editBindings` SHALL set `bound_at` on each new or changed checkout.

#### Scenario: Session on the other device
- **WHEN** a session of AW-3 runs on ubuntu-01 and a person removes `billing-api` on macbook-pro
- **THEN** ubuntu-01 stops the session, AW-3 has `session.ended` with reason `stopped`, and the `bindings.yaml` of ubuntu-01 has no `billing-api` checkout

### Requirement: Worktree and branch cleanup
After the stop, each computer SHALL remove the AW worktree of each removed task when it is clean and its branch has no unpushed commit, and SHALL then delete the branch `aw/<key>`. A commit is unpushed when no remote branch and no other local branch has it. A dirty worktree, a worktree whose HEAD has a commit that no branch has, or a branch with an unpushed commit SHALL stay, and the reply of the remove on this device SHALL list it with the reason. Another device SHALL write the kept items to its log and as a system comment on the removed task. AW SHALL remove no folder of a checkout session or a folder session.

#### Scenario: Unpushed branch stays
- **WHEN** the branch `aw/AW-2` has a commit that no other branch has, and the person removes the project
- **THEN** the worktree and the branch stay, and the reply lists `aw/AW-2` as kept with "unpushed commits"

#### Scenario: Commit on a detached HEAD stays
- **WHEN** the worktree of AW-6 has a detached HEAD with a commit that no branch has, and the person removes the project
- **THEN** the worktree stays, and the reply lists it as kept with "commits that no branch has"

#### Scenario: Clean branch goes
- **WHEN** the worktree of AW-1 is clean and `origin/aw/AW-1` has each commit of `aw/AW-1`
- **THEN** the worktree folder and the local branch `aw/AW-1` are gone after the remove

### Requirement: Removed data stays recoverable
AW SHALL delete no task folder, task log or `project.yaml` at a remove. `aw task show` and `aw thread` SHALL still read a removed task, and a write to a removed task SHALL give 404. The removal event SHALL keep a copy of `project.yaml`. The phone SHALL not list a removed project or its tasks, and New task of the phone SHALL not offer a removed project.

#### Scenario: Read a removed task
- **WHEN** a person removes `billing-api` and runs `aw task show AW-1` and `aw thread AW-1`
- **THEN** both show AW-1, and a new message to AW-1 gives 404

#### Scenario: Files after a remove
- **WHEN** a person removes `billing-api`
- **THEN** `tasks/<task-id>/` of each of its tasks and `tasks/projects/billing-api/project.yaml` are still on disk

