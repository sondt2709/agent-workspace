## Why
On a remote server, the person wants to choose the folder of each workspace, and that folder can hold other files (docs/decisions/2026-11-24-workspace-folder.md). Today `aw pair --path` and `aw workspace init` need the exact workspace folder. A default folder with other files fails (`aw pair`) or gets the workspace written into it (`aw workspace init`). The workspace then mixes with the files of the person, and a `tasks`, `knowledge` or `secure` folder of the person syncs to each device.

## What Changes
- New location form: `aw pair <code> --in <folder>`, `aw workspace init --in <folder>`, the field `parent` of `POST /v1/workspaces` and `POST /v1/pairing/join`. AW puts the workspace in `<folder>/<workspace name>`. When that name is taken, AW uses `<name>-aw1`, then `-aw2`, up to `-aw99`.
- The default location is `~/AW` with the same rule. **BREAKING** (behavior): a default folder that is taken now gives `<name>-aw1`, not a `conflict` error or a write into a folder of the person.
- `--path` keeps its meaning: the workspace folder itself, missing, empty or of the same workspace.
- Safety checks for each form, with symbolic links resolved: not in AW_HOME, not in or around another workspace folder, not in or around a checkout of this device, writable.
- The replies say the folder: `folder_note` in the init reply, `folder` and `folder_note` in the pairing view. `aw status` shows a `Folder:` line per workspace.
- Desktop: "Join with a pairing code" and "Add a workspace" get a Location field (default `~/AW`). Settings lists the workspaces of this computer with their folders. Devices & sync shows the folder of the current workspace on this device.

## Capabilities

### New Capabilities
- `workspace-folder`: the folder rule for a new or joined workspace (location, suffix, free and taken folders, safety checks, the reply note).

### Modified Capabilities
- `device-pairing`: "Join with a code" takes `parent`, uses the folder rule for the default folder, and shows the folder.
- `workspace-setup`: "Personal workspace by default" uses the folder rule; "Desktop setup screens" get the Location field.
- `aw-cli`: `--in` for `aw pair` and `aw workspace init`; the `Folder:` line of `aw status`.
- `desktop-app`: "Settings sections" gets "Workspaces on this computer".
- `desktop-devices`: Devices & sync shows the workspace folder of this device.

## Impact
- Code: `daemon/src/service/workspace-folder.ts` (new), `daemon/src/service/daemon.ts`, `daemon/src/service/pairing.ts`, `daemon/src/cli/*`, `shared/client/src/schemas.ts`, `shared/client/src/identity.ts`, `contracts/openapi.yaml`, desktop `WorkspaceMenu.tsx`, `Pairing.tsx`, `Settings.tsx`, `Devices.tsx`, the bridge contract.
- API: additive optional fields. No synced file changes. No new dependency.
- Docs: `docs/phase-1.md`, `docs/workflow.md`, `docs/design.md`, `docs/decisions/2026-11-24-workspace-folder.md`.
- E2E: `e2e/src/workspace-folder.docker.test.ts`.
