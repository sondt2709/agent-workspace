## 1. Folder rule in awd

- [x] 1.1 Write `daemon/src/service/workspace-folder.test.ts` first (empty, missing, non-empty location; taken name; `-aw1` taken; file; symbolic link candidate; symbolic link location; same workspace; AW_HOME; inside a workspace; inside a checkout; not writable; `-aw99` limit) and see it fail
- [x] 1.2 Add `daemon/src/service/workspace-folder.ts`: `folderName()` (moved), `chooseWorkspaceFolder()`, `checkJoinFolder()`, the safety checks and the note
- [x] 1.3 Use the rule in `DaemonService.#initWorkspace` (`parent`, default location `~/AW`, `folder_note`), and build the folder context (registered folders, checkouts of this device, AW_HOME)
- [x] 1.4 Use the rule in `PairingService.join()` (`parent`, default, `--path` exact); reserve the folder of open joins; add `folder` and `folder_note` to the pairing view
- [x] 1.5 Add `parent` and `folder_note` to the client schemas (`initWorkspaceBody`, `joinBody`, the init reply, `pairingView`); `path` with `parent` gives 400; generate `contracts/openapi.yaml`

## 2. CLI

- [x] 2.1 `aw workspace init --in <folder>` and `aw pair --in <folder>`; refuse a path with `--in`; print the folder and the note
- [x] 2.2 `aw status` prints `  Folder: <path>` under each workspace
- [x] 2.3 Service and CLI tests: init with `parent` and a taken name; default init with files of the person; the gap-setup L2 test now gives `-aw1`; `pairing.test.ts` join with `parent` and a taken name; the old `--path` form

## 3. Desktop

- [x] 3.1 Bridge contract: `joinPairing` and `initWorkspace` take `parent`
- [x] 3.2 Location field in "Join with a pairing code" and "Add a workspace"; the folder and the note in the dialogs
- [x] 3.3 Settings section "Workspaces on this computer"; Devices & sync row "Workspace folder" on the card of this device
- [x] 3.4 Desktop unit tests for 3.1 to 3.3; `cd desktop && task check`

## 4. Docs and e2e

- [x] 4.1 Update `docs/phase-1.md` (3, 8 step 6), `docs/workflow.md`, `docs/design.md`; add `docs/decisions/2026-11-24-workspace-folder.md`
- [x] 4.2 Add `e2e/src/workspace-folder.docker.test.ts` (non-empty location, conflict, old `--path` refused) and run it in Docker
- [x] 4.3 Real run between this Mac and a remote Linux test computer (ubuntu-01), in an own test folder
- [x] 4.4 Desktop off-screen screenshots before and after (dark, light, 400 px)
- [x] 4.5 Break each new test once; root `task check` on the last commit
