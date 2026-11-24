## 1. Schemas and contracts

- [x] 1.1 Add `archived` and `main_repo` to projectV1; regenerate `contracts/schemas`, samples and the Kotlin classes
- [x] 1.2 Make `path` optional in `initWorkspaceBody`; add `@aw/client/setup` (schemas and `SetupClient`)

## 2. awd

- [x] 2.1 `config.yaml` `sync.community`; `communityFromEnv` in the settings; `SyncService.setCommunity`; transport `setCommunity()` with `communityOptions()`
- [x] 2.2 Default "Personal" workspace in `Daemon.initWorkspace`; `renameWorkspace` and `removeWorkspace` (session detach, engine folders)
- [x] 2.3 `service/setup.ts`: project edit, bindings read and edit, sync settings; archived check in `createTask`
- [x] 2.4 `api/setup-routes.ts` with person routes; register in `app.ts`; regenerate `contracts/openapi.yaml`
- [x] 2.5 `cli/setup.ts`: `aw workspace rename|remove`, `aw project edit|archive|unarchive`, `aw binding show|set|remove|slot|orca`; `aw workspace init` with no path; `aw sync community`; human commands
- [x] 2.6 Session manager messages name `aw binding set` and `aw binding orca on`
- [x] 2.7 Unit tests: service, routes, CLI, settings, transport options

## 3. Desktop

- [x] 3.1 Setup calls (`setup-contract.ts`, `setup-calls.ts`) joined into the bridge contract and main
- [x] 3.2 Home empty state button; workspace add, rename, remove in the navigation
- [x] 3.3 `ProjectSettings.tsx` page and its route and nav item
- [x] 3.4 Settings: Sync section with the D18 text and the switch
- [x] 3.5 Component tests

## 4. Docs and checks

- [x] 4.1 `docs/phase-1.md` 6.2 and 3.1, `docs/workflow.md` 8, `AGENTS.md` status line
- [x] 4.2 `task check` green
