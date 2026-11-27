## Context

- A task with `work_in: worktree` needs a commit in the checkout. `git worktree add … HEAD` fails with `invalid reference: HEAD`, and `orca worktree create` fails with "Could not resolve a default base ref". awd writes the error once and tries again each 60 s with no new comment.
- `work_in: checkout` always runs `git switch` to `aw/<key>`, and `#plainHost` always picks tmux: the code assumes that Orca opens a terminal only in an Orca worktree.
- Orca 1.4.268 opens a terminal in the main folder of a known repo (`terminal create --worktree path:<checkout>`). inbox2agent (`internal/agent/orca.go`, fixtures of 2026-10-28) starts agents in a main folder this way, and runs `repo add --path <folder>` when Orca answers `selector_not_found`.
- The phone reads only synced files. The commit state of a checkout is known only on its device.

## Goals / Non-Goals

**Goals:**
- A person sees in the form that a checkout with no commit cannot have a worktree, and picks another "Work in".
- A task that still asks for a worktree gets a comment that names the fix, and starts after the first commit with no new assign.
- "Project checkout" can keep the branch of the checkout, and can run in Orca.
- Agent teams and "Start the agent now" are on by default in the forms of a person.

**Non-Goals:**
- AW makes no commit in a checkout of the person.
- No warning in "Add project" or in the checkout binding (a later change).
- "Other folder" stays in tmux. Orca needs a git repo for `repo add` with the default kind.
- No change of the schema default of `agent_teams`.

## Decisions

1. **The commit state goes in `health.yaml`, not in `bindings.yaml`.** `health.yaml` is the observed state of a device. awd writes it at most once per 60 s, and a changed body gives a new write. `bindings.yaml` holds the choices of the person. New optional field: `checkouts: [{project, has_commit}]`. The check is `git rev-parse --verify --quiet HEAD^{commit}`, with the local git time limit. A checkout that is not a git repository gets `has_commit: false` too, so the form disables the worktree for it as well.
2. **The forms read `has_commit` from the device of the assignee.** The desktop gets it in the session-hosts route (next to `session_host` of each checkout). The phone reads it from the health document of the device. A missing value (an older awd, or no health yet) keeps "Separate worktree" enabled. The daemon check then gives the comment.
3. **awd checks the commit before it calls git or the host.** In `#worktree`, after the "is not a git repository" check. The error goes through `#startFailed`, which already adds "AW tries again in 60 s." The same message gives no second comment, so a retry is silent until the cause changes.
4. **`switch_branch` is a new field of `sessionOptions`, default `true`.** Old events have no field and keep the current behavior. With `false` and `work_in: checkout`, `#folder` returns the checkout with `branch: null` and `base: null`, as `work_in: folder` does. So the checkpoint push, the move commit and the project-remove cleanup do nothing with a branch. The one-session-per-checkout rule stays. An alternative was a 4th `work_in` value. That needs more UI and Kotlin changes for the same result.
5. **Project checkout in Orca.** `#plainHost` gets the work type. For `checkout`, it uses `#chooseHost` (the same Orca checks and comments as a worktree). The Orca host `open()` runs `terminal create --worktree path:<cwd>`. On `selector_not_found`, it runs `repo add --path <cwd>` once and tries again (the inbox2agent pattern). `list()` keeps only `aw-` folders, so the terminal list of the main folder does not change it. The project-remove cleanup keeps the checkout (`workIn: checkout` returns before the host remove), so AW never removes the main worktree in Orca.
6. **Defaults of the forms.** `NEW_TASK_FORM` and the New session form set `teams: true` on the desktop and on the phone. The schema default of `agent_teams` stays `false`, so an agent subtask and an old event keep no teams. New task sets the assignee to `startAgent()` when the project changes and the person did not change the switch.

## Risks / Trade-offs

- [Orca can refuse `repo add` for a git repo with no commit] → The error goes to the thread as a start error. The manual check with AW-5 shows the real answer.
- [The health write is up to 60 s old] → The form can show a stale state for 60 s. The daemon check stays the guard.
- [`switch_branch: false` lets the agent commit on the branch of the person] → The Project checkout warning says that the session works on the branch that is checked out.
- [Agent teams on by default uses more tokens] → The person can turn it off in each form.
