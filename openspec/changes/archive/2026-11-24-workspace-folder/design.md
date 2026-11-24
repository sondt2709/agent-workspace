## Context
- `aw pair --path <folder>` (`POST /v1/pairing/join {path}`) takes the workspace folder itself. The default is `~/AW/<safe name>`. `PairingService.#checkRoot` refuses a folder with other files or another workspace (409), also for the default folder.
- `aw workspace init [path]` (`POST /v1/workspaces {path?}`) creates or registers a folder. With no path it uses `~/AW/<name>`. It refuses a default folder of another workspace (gap-setup L2), but it writes a new workspace into a folder with other files (evidence `base/init-default-nonempty.txt`). Only `tasks`, `knowledge` and `secure` sync, so a file at the top level stays local, but a `tasks` or `knowledge` folder of the person would sync.
- The workspace folders of this device are in `~/.aw/config.yaml`. The session guard and the sessions read them there. The bindings of each workspace (`tasks/bindings/<device>.yaml`) hold the checkouts of this device.
- The desktop Join dialog has only the code. "Add a workspace" sends `path`.

## Goals / Non-Goals
**Goals:** one folder rule for join and init; a location with other files; the suffix `-awN`; the safety checks; the folder shown in the CLI and the desktop app; the old `--path` form unchanged.

**Non-Goals:** a move of a registered workspace to another folder; a folder choice on the phone (its storage is app-private); the record of the folder in synced files.

## Decisions
1. **`--in <folder>` is the location; `--path` stays the workspace folder.** The API field is `parent`; `path` and `parent` together give 400. Alternative: `--path` as a location. Rejected: old scripts would get `<path>/<name>`, and one flag with 2 meanings is not clear.
2. **The default location is `~/AW`**, with the suffix rule. So the default and `--in` behave the same. This also fixes the write into a folder of the person.
3. **Free and taken candidates.** A candidate `<location>/<name>` (then `-aw1` .. `-aw99`) is free when it does not exist, when it is a folder with only `tasks`, `knowledge`, `secure` and `.DS_Store` (a retry after a failed join), or when its `tasks/workspace.yaml` is of this workspace (join: the same id; init: the same name and key prefix). It is taken when it is a file, a symbolic link, a folder with other files, a folder of another workspace (or a `tasks/workspace.yaml` that does not parse), a registered folder of another workspace, or the folder of an open join. After `-aw99`, 409 `conflict`. The name part is `folderName()` (moved to the new module): no path separator, no leading dot, the workspace id as fallback.
4. **Safety checks** (refused, no suffix): the chosen folder (`--path`, or the candidate of `--in`) is not in AW_HOME and does not hold it; it is not in a registered workspace folder and does not hold one; it is not in a checkout of this device and does not hold one; the nearest existing folder on its path is writable (`access W_OK`). Each comparison uses the real path: `realpath()` of the nearest existing ancestor plus the rest. The stored path stays the normalized path as given, so the guard and the old tests see the same text. Checkouts come from the bindings of this device in each open workspace.
5. **Where the folder is recorded:** only in `~/.aw/config.yaml`, as today. No other device uses the folder; it is a home path (personal data) that would sync to each device and the phone. Alternative: a `folder` field in the device record. Rejected for these reasons.
6. **Replies:** the init reply gets `folder_note` (string or null); the pairing view gets `folder` (the join side; null on the show side) and `folder_note`. The note is one sentence: "`<location>/acme` is in use (other files), so AW uses `<location>/acme-aw1`." `aw pair` prints the folder and the note on stderr (stdout keeps the reply); `aw workspace init` prints the note under its result line; `aw status` prints `  Folder: <path>` under each workspace.
7. **Module:** `daemon/src/service/workspace-folder.ts` exports `folderName()`, `chooseWorkspaceFolder(input, context)` and the type `FolderContext {home, registered[], checkouts[], reserved[]}`. `DaemonService` builds the context; `PairingService` gets it through a dependency `folderContext()`. One rule, no copy.
8. **Desktop:** the Join dialog and "Add a workspace" have a "Location" field with "Choose…" (purpose `workspace`) and the placeholder `~/AW`. Empty means the default. They send `parent`. The Join dialog shows "Folder: <path>" and the note while it runs. "Add a workspace" shows the note in a success alert before it opens the Inbox when AW used a suffix. Settings gets the section "Workspaces on this computer" (name and folder, from `GET /v1/workspaces`). Devices & sync gets the property row "Workspace folder" on the card of this device.

## Risks / Trade-offs
- [A person expects `--in` to be the workspace folder] → the reply and the CLI always print the folder; `--help` says "the folder that holds the workspace folder".
- [A workspace with the same name and key prefix in a candidate folder is registered, not skipped (init)] → this is the gap-setup L2 behavior for a removed workspace; the reply says "Registered".
- [Desktop Add can no longer register a folder that another device synced] → the error names `aw workspace init <path>`; the CLI keeps it.
- [Race: two joins choose the same free name] → open joins reserve their folder; init runs in a queue.

## Migration Plan
No data change. The new fields are optional. Rollback: revert the commit.

## Open Questions
None.
