## Context

A project is the shared file `tasks/projects/<slug>/project.yaml`. Each task folder `tasks/<task-id>/` names its project by slug in `task.created`. Each device writes its own `bindings.yaml` with the checkout of each project. `addProject` refuses each slug in `view.projects`, also an archived one. So a project that points to a wrong folder blocks the slug for good. The owner hit this (decision 41), and a maintainer removed the project by hand.

Constraints: each device writes only its own files and logs (docs/phase-1.md 4); a shared file can lose a concurrent edit in the conflict resolver (6.6); AW and the phone must give the same view (3.5.3); AW never deletes a task folder (architecture 4.3.4) and loses no data silently (principle 8); a person command is refused to a session caller (principle 4).

## Goals / Non-Goals

**Goals:**
- One person action removes a project on each device: views, sessions, checkouts, clean worktrees and branches.
- The slug is free at once; a re-add with a new folder works.
- A defined, tested result when a remove and a new task happen at the same time on 2 devices.
- Each file of the project stays recoverable.

**Non-Goals:**
- An "Undo remove" screen. The files stay; recovery is by hand (docs).
- Removal of the knowledge files of the project (`knowledge/projects/<slug>/`). They stay, and a re-add with the same slug uses them.
- A remove from the phone. The phone shows the result only.
- An Inbox notice for a kept branch on another device (open item).

## Decisions

1. **Removal is an append-only workspace event.** `project.removed {project, name, document}` in `tasks/log/<device>.jsonl`, by a person (`human@<device>`). `document` is the copy of `project.yaml` at the remove. Alternative: a `removed` field in `project.yaml`. Rejected: the conflict resolver keeps one version of a shared file, so a concurrent edit on another device can drop the remove. A log line is never lost, and it has an HLC, so it has an order against the task events.
2. **Liveness by HLC.** `project.yaml` gets the optional `added_at` (HLC, null for older files). With R the newest `project.removed` of the slug: the project is live when there is no R, or `added_at` sorts after R. A concurrent edit of the old file (Syncthing keeps a changed file over nothing) keeps the old `added_at`, so the project stays removed.
3. **Task rule.** With R as above, a task of the slug is removed when its `task.created` HLC sorts before R, or when the project is not live. So a task that another device creates at the same time goes with the project, also with a faster clock; after a re-add, only tasks created after R show. A task with no project (no `task.created` yet) is never removed.
4. **The view hides, the files stay.** `view.projects` and `view.tasks` hold only live items. New fields: `removed_projects` (one row per removal event: slug, name, removal ref, the `document` copy) and `removed_tasks` (full `TaskView`, sorted by id). The index, the desktop, the CLI and the phone read the live lists, so nothing else changes. Key duplicates are marked before the split, so a live task never shares a key with a removed one. `nextFreeKey` counts the removed tasks: no new task gets the key and the branch `aw/<key>` of a removed task.
5. **Sessions stop on their own device.** The session manager stops a running session whose task is in `removed_tasks`, with reason `stopped` and `session.ended` in the hidden task log. Not `moved`: a remove must not push a wake branch to a remote. This is the same pattern as revoke and the phone "Stop session": the device that runs the session acts on the synced state.
6. **Cleanup once per removal on each computer.** For each removed task with a session record on this device, after its session stopped: an AW worktree (tmux `~/.aw/worktrees/...`, or the Orca worktree) that is clean and whose branch has no unpushed commit is removed (`git worktree remove`, or `SessionHost.removeWorktree()` for Orca), then `git branch -d aw/<key>` (and the local name before a rekey). "Unpushed": a commit of the branch that no remote branch and no other local branch has (`git rev-list --count <branch> --not --exclude=refs/heads/<branch> --branches --remotes`). A repository with no remote keeps each branch with own commits. A checkout session (`work_in: checkout`) and a folder session: AW removes no folder; it deletes the branch only when it is not checked out and has no unpushed commit. Each kept item has a reason. The device records the done removal ids in `~/.aw/removed/<workspace id>.json` so a restart does not repeat the comments.
7. **Bindings by HLC.** `checkouts[].bound_at` (HLC, optional) is set by `editBindings` on each new or changed checkout. Each computer removes its own checkout of a slug with a removal R when `bound_at` is null or sorts before R. So an offline device drops its old folder after it syncs, and a checkout set after a re-add stays.
8. **Re-add.** `addProject` refuses only a live slug. It writes a new `project.yaml` with `added_at` = an HLC of this device that sorts after each removal of the slug. The files layer observes each merged HLC, so `now()` is already later; the service checks it.
9. **One service, 2 calls.** `projectRemoval(service, slug)` gives the preview: the project, the open tasks (not done, not archived), the running sessions (task, device, session id). `removeProject(service, daemon?, slug)` writes the event, then runs the local stop and cleanup and returns the preview plus the local result (`removed` and `kept` worktrees and branches, `checkout_removed`). Routes: `GET /v1/workspaces/{ws}/projects/{project}/removal`, `POST /v1/workspaces/{ws}/projects/{project}/remove` (person routes). CLI: `aw project remove <slug>` prints the preview and exits 1; `--yes` removes. Desktop: a "Remove" section in Project settings with a dialog that shows the preview and asks to type the slug.
10. **Kotlin port.** `WorkspaceFold.kt` folds the event; `MergeEngine.kt` applies decisions 2 to 4; `View.kt` gets the 2 fields; `PhoneActions.freeKey` counts `removedTasks`. The merge case `project-removed` is the contract.

## Risks / Trade-offs

- [A removed task created after R on a slug that is not live shows again after a re-add] → Documented as the merge rule; its created HLC is after the remove, so it is a new task of the new project.
- [Cleanup deletes a branch that the person still wants] → Only a branch whose commits another branch has; the reply lists each removed and kept item; the reflog of the checkout still has the commit.
- [A device is offline for a long time] → It stops its sessions and cleans up at its next merge; the rule needs no live coordination.
- [Older awd or phone versions] → They keep the unknown event (not applied) and show the project until they update; all devices update together (self-update).
- [Each merge expected.json changes] → Generated by `shared/core/scripts/merge-expected.ts`; the Kotlin test reads the same files.

## Migration Plan

No migration: the new fields are optional and the event is new. Rollback: an older awd ignores the event, and the project shows again with its tasks.

## Open Questions

- An Inbox notice for a kept branch on another device (phase 2 or a later task).
