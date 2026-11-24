## Why

The phase-1 gap audit (task T1, gaps M1 to M4) found that a person cannot set up AW without editing YAML files by hand. A fresh desktop install has no workspace, nothing changes a project after `aw project add`, no session can start without a hand-made checkout binding, and the community relay switch exists only as an environment variable (PRD WS-01/02/05/06/07, DEV-05/06, AGT-19, SYN-06, decision D18).

## What Changes

- `POST /v1/workspaces` with no `path` creates the "Personal" workspace at `~/AW/Personal`. `aw workspace init` with no path does the same. The desktop empty state has a "Create the Personal workspace" button.
- New routes `PATCH /v1/workspaces/:ws` (rename: the name in `workspace.yaml`) and `DELETE /v1/workspaces/:ws` (unregister: the files stay). New commands `aw workspace rename` and `aw workspace remove`.
- New route `PATCH /v1/workspaces/:ws/projects/:project` for the name, the devices, the default agent, the links, the main repository, the test servers, the switches and `archived`. New fields `archived` and `main_repo` in `project.yaml`. A new task in an archived project is refused. New commands `aw project edit`, `aw project archive` and `aw project unarchive`.
- New routes `GET` and `PATCH /v1/workspaces/:ws/bindings` for the bindings of this device: checkouts (project, path, session host), test slot resources and `use_orca`. New commands `aw binding show|set|remove|slot|orca`. The session manager messages name `aw binding set` instead of a hand edit.
- The community switch goes into `config.yaml` (`sync.community`). New routes `GET` and `PUT /v1/sync/settings` and the command `aw sync community [on|off]`. awd applies a change to the running engine through its REST API. `AW_SYNC_COMMUNITY`, when set, wins and the switch is read-only.
- Desktop: add, rename and remove a workspace and add a project in the navigation; a project Settings page; a Sync section with the D18 text and the switch in Settings.

## Capabilities

### New Capabilities
- `workspace-setup`: the routes, the CLI commands and the desktop screens that set up workspaces, projects, the bindings of this device and the community switch.

### Modified Capabilities
- `workspace-schemas`: `project.yaml` gets `archived` and `main_repo`.
- `sync-engine`: the community switch applies to a running engine.

## Impact

- `daemon/`: new `service/setup.ts`, `api/setup-routes.ts`, `cli/setup.ts`; small changes in `service/daemon.ts`, `service/sync.ts`, `service/workspace.ts` (archived check), `sessions/service.ts` (detach), `sessions/manager.ts` (messages), `settings.ts`, `state.ts`, `api/app.ts` and `cli/run.ts` (registration). `aw sync community` is added to the `sync` command from `cli/setup.ts`.
- `plugins/sync-syncthing/src/transport.ts`: `setCommunity()`.
- `shared/schema` (project fields), `shared/client` (new `./setup` export, optional `path`), `contracts/` (generated schemas, OpenAPI, Kotlin classes).
- `desktop/`: new `ProjectSettings.tsx`, `WorkspaceMenu.tsx`, setup calls; Settings and AppShell.
- Docs: `docs/phase-1.md` 6.2 (the desktop setting exists now), `docs/workflow.md` 8 (commands).
