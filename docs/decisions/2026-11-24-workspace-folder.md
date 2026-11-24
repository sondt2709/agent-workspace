# Decision: workspace folder rule

| Item | Value |
|---|---|
| Date | 2026-11-24 |
| Status | Accepted by the product owner |
| Changes | `phase-1.md` 3 and 8 (step 3 and 6), the `aw pair` and `aw workspace init` options |

## Request
On each device, also a remote server, the person chooses the folder of each workspace. The folder can hold other files. When the name is taken, AW adds a suffix: `-aw1`, `-aw2`.

## Decision
1. The person chooses a location for each workspace on each device: `aw pair <code> --in <folder>`, `aw workspace init --in <folder>`, API field `parent`, the desktop Location field. The default location is `~/AW`.
2. The location can hold other files. AW uses `<location>/<name>`. The name is the workspace name with no path separator and no leading dot.
3. When `<name>` is taken, AW uses `<name>-aw1`, then `-aw2`, up to `-aw99`. Then it refuses (409).
4. Taken: a file, a symbolic link, a folder with other files than `tasks`, `knowledge`, `secure`, `.DS_Store`, the folder of another workspace, a registered folder of another workspace, the folder of an open join.
5. Free: a missing folder, an empty folder, the folder of the same workspace (join: the same id; init: the same name and key prefix).
6. The reply names the folder that AW used (`folder`, `folder_note`). `aw status` shows `Folder:` for each workspace.
7. `--path` (and the path argument of `aw workspace init`) keeps its old meaning: the workspace folder itself. A join refuses a folder with other files there, and the error names `--in`.
8. Safety checks for each form, with symbolic links resolved: not in AW_HOME and not holding it; not in another workspace folder and not holding one; not in a checkout of this device and not holding one; the nearest existing folder is writable.
9. The folder stays in `~/.aw/config.yaml`. awd does not write it into a device record or the bindings.
10. (Check, 2026-11-24) awd compares a candidate with the registered folders and the open joins by real paths. It refuses a folder in a folder with `tasks/workspace.yaml`, also when that workspace is not registered. A join chooses and reserves its folder in the init queue, and checks the folder again after the approval. A folder that AW cannot read is taken.
11. (Check, 2026-11-24, wf-2) A location of `aw workspace init --in` or "Add a workspace" that has `tasks/workspace.yaml` is registered as that workspace (`created: false`, with a note). So "Add a workspace" registers a folder that another device synced again.

## Reasons
- A new flag keeps old scripts working: `--path /srv/aw/acme` still means that folder.
- One rule for the default and `--in` removes a case where `aw workspace init` wrote a workspace into a folder of the person.
- No other device uses the folder, and a home path is personal data that would sync to each device and the phone.
- A symbolic link candidate can change its target later, so AW does not use it. A registered link is the choice of the person, so AW uses it for its own workspace.
- A location behind a link, or a workspace folder whose files did not arrive yet, must not give 2 workspaces one folder: their files would sync into each other.

## Not in scope
- A move of a registered workspace to another folder.
- A folder choice on the phone: its storage is app-private.
