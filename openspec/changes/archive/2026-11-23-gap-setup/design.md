## Context

awd has `POST/GET /v1/workspaces`, `POST/GET .../projects` and the `aw workspace init/list`, `aw project add/list` commands. `bindings.yaml` gets only `may_run` at the open; the session manager asks the person to edit it by hand. The community switch is `AW_SYNC_COMMUNITY`, read at the start. `workspace.yaml` has `switches.community_relays`, but nothing reads it. Task T2 (gap-install) runs at the same time and also registers routes and commands, so new code goes in new files.

## Goals / Non-Goals

**Goals:**
- A person sets up a workspace, its projects, the bindings of this device and the community switch from the CLI, the API or the desktop app, with no YAML edit.
- The community switch applies to a running engine.

**Non-Goals:**
- Bindings of another device (each device writes only its own `bindings.yaml`).
- Queue reorder, project edit on the phone, device health on Home (nice-to-have gaps).
- A folder per workspace on the phone (N13).

## Decisions

1. **No silent "Personal" workspace at the first start of awd.** The first new workspace of a device makes the master key, and `aw pair` refuses a device with its own master key. A remote computer or a second Mac must stay free to join. So "Personal" is the default of the first explicit setup step: `aw workspace init` with no path, `POST /v1/workspaces` with no `path`, and the desktop empty state button "Create the Personal workspace". The audit text "awd creates it at the first start" is changed here; the reason is in the result handoff. Default folder: `~/AW/<name>` (the same rule as a pairing join).
2. **Remove = unregister.** `DELETE /v1/workspaces/:ws` removes the entry from `config.yaml`, closes the workspace, stops its session manager and removes its 3 engine folders. The files stay; the reply says so and names the folder. awd refuses (409 `conflict`) while a session of the workspace runs on this device.
3. **Project edit is a read-modify-write in the write queue** (`WorkspaceService.write`), so it never runs at the same time as another write of the workspace. `project.yaml` is a shared file: the priority rule of the merge resolves a conflict.
4. **`main_repo` is a separate field** (nullable). When it is set and not in `links`, awd adds it to `links` at the front. Reason: PRD WS-07 needs one main repository; a "first link" rule is not visible in the file.
5. **One `PATCH /v1/workspaces/:ws/bindings` route** with optional `use_orca`, `resources` (the full map) and `checkouts` (upsert per project; `path: null` removes it), instead of many PUT routes. Fewer routes, one client call per form. A checkout path must be absolute and an existing folder.
6. **Community switch in `config.yaml` (`sync.community`)**, not in `workspace.yaml`: one engine serves all workspaces of a device. `AW_SYNC_COMMUNITY`, when set, wins; then `PUT` gives 409 `conflict` and names the variable. awd applies a change with `PATCH /rest/config/options` (`globalAnnounceEnabled`, `relaysEnabled`, `announceLANAddresses`). With no running engine the value applies at the next engine start. `workspace.yaml` `switches.community_relays` stays in the schema (file-format contract) and stays unread.
7. **Shared registration files change only at the registration lines**: `registerSetupRoutes` in `api/app.ts`, `addSetupCommands` in `cli/run.ts`, the setup calls in `desktop/src/shared/setup-contract.ts` and `desktop/src/main/setup-calls.ts`, joined in `contract.ts` and `calls.ts` by one line each. The client methods are in a new `@aw/client/setup` export.

## Risks / Trade-offs

- [The engine may need a restart for a relay change] → awd patches the options; the next engine start applies the same value. A test on a real engine is in "Test later".
- [Two devices rename one workspace at the same time] → `workspace.yaml` is a shared file; the merge keeps one value by the priority rule.
- [Unregister while the engine is down] → the engine folders go at the next engine start, because awd adds only the folders of registered workspaces; the old folder config stays until then. Recorded as an open issue.
