## Why
The owner wants "Skip permissions" as the default mode (decision 38), and the phone New task misses fields of the desktop New task (title, "Start the agent now", parent task, credentials from a list, the "Project default" choice).

## What Changes
- `new_project_permission_mode` and the project `permission_mode` default to `skip`; a missing value counts as `skip` (workspace and project). `aw project add` and desktop Add a project give a new project `skip` unless a person chose another mode.
- New task preselects "Skip permissions" on the desktop and the phone; "Project default · <mode>", Default and Accept edits stay choices.
- The safety rules of session-options stay: only a person's task or project gives skip; an agent subtask never gets it.
- The phone New task gets each field of the desktop New task (list in the result handoff).
- `SECURITY.md`, `docs/workflow.md`, `docs/phase-1.md`, `docs/design.md`.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `permissions-default`: the default is `skip`; a missing value counts as `skip`.
- `session-options`: New task preselects Skip permissions.
- `android-app`: the phone New task has each desktop field.

## Impact
`shared/schema` (defaults; generated JSON Schemas, samples and Kotlin classes), merge fixtures (`expected.json`), `daemon` (`newProjectMode`), desktop (`NEW_TASK_FORM`, `projectMode`, `newProjectsMode`), `android/shared` (`ProjectView.permissionMode`), `android/control` (`NewTaskDraft.title`, `START_OPTIONS`, `NewTaskChoices`), `android/app` (New task, Session block).
