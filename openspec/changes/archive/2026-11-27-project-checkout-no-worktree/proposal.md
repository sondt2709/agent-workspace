## Why

A person created AW-5 in a project whose checkout is a git repository with no commit. Orca refused the worktree ("Could not resolve a default base ref"), AW wrote one comment with the Orca error, and the task got no session for a day. The person cannot see the cause or the fix. Also, "Project checkout" always changes the branch of the checkout and always runs in tmux, so a folder that needs no task branch (notes, operations work) cannot run in Orca.

## What Changes

- awd writes the commit state of each checkout of the device (`has_commit`) in its `health.yaml`. The desktop and the phone read it.
- New task, New session and "Assign to another device…" disable "Separate worktree" for a checkout with no commit, show the cause, and select "Project checkout".
- awd refuses a worktree for a checkout with no commit before it calls git or Orca. The comment names the checkout and the 2 fixes. After a first commit, the next start try (60 s) starts the session.
- "Project checkout" gets the option "Switch to the task branch" (on by default). Off: AW makes no branch and changes no branch, as with "Other folder". New session option `switch_branch`.
- A session in the project checkout runs in Orca when the host choice is Orca. The Orca host opens the terminal in the main folder and adds the checkout to Orca with `repo add` when Orca does not know it (the pattern of an earlier Orca driver).
- New task and New session preselect "Agent teams". The label "experimental" goes away.
- New task preselects "Start the agent now" when the project has a device.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `session-options`: the new option `switch_branch`, the disabled "Separate worktree", the preselected Agent teams and "Start the agent now", the labels with no "experimental".
- `agent-sessions`: the working folder of `checkout` with no branch switch, the start refusal for a checkout with no commit, and the Orca host for the project checkout.
- `session-host-orca`: `open()` in the main folder of a checkout, with `repo add` on `selector_not_found`.
- `workspace-schemas`: `health.v1` gets `checkouts` with `has_commit`; `session_options` gets `switch_branch`.

## Impact

- `shared/schema` (`common.ts`, `documents.ts`), the generated `contracts/schemas/`, `contracts/samples/` and the Kotlin classes.
- `daemon/src/sessions/manager.ts`, `daemon/src/continuity/health.ts`, `daemon/src/service/session-hosts.ts`.
- `plugins/host-orca/src/orca.ts` and the fake Orca CLI.
- Desktop: `session-options-model.ts`, `SessionOptions.tsx`, `dialogs.tsx`, `create-model.ts`.
- Android: `SessionOptionsForm.kt`, `SessionOptionsParts.kt`, `FormScreens.kt`.
- No new dependency. Old events keep their meaning: `switch_branch` defaults to `true`, and `agent_teams` keeps the default `false` in the schema.
