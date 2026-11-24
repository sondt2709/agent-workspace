# Orca CLI replies (orca-ide 1.4.257)

Source: real replies of `orca-ide <command> --json` on the Linux remote device, captured on 2026-11-23 from a private Orca runtime (`ORCA_USER_DATA_PATH=<dir> orca-ide serve --port 6799 --bind 127.0.0.1 --no-pairing`). The runtime had only the test repo of the capture.

Changes after the capture:

- Home paths are `/home/user`, the test repo is `/home/user/src/aw-test-repo`, the host name is `ubuntu-01`, the user name is `user`.
- The fields `preview`, `tail` and `gitUsername` are removed (they hold the shell prompt and the login message).

| File                                     | Command                                                                                                              |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `version.txt`                            | `orca-ide --version`                                                                                                 |
| `status.json`                            | `status --json` (runtime ready)                                                                                      |
| `status-down.json`                       | `status --json` after the runtime stopped (`runtime_unavailable`)                                                    |
| `repo-list-empty.json`, `repo-list.json` | `repo list --json` before and after `repo add`                                                                       |
| `repo-add.json`                          | `repo add --path <checkout> --json`                                                                                  |
| `worktree-create-repo-not-found.json`    | `worktree create --repo path:<checkout>` before `repo add`                                                           |
| `worktree-create.json`                   | `worktree create --name aw-<task-id> --repo id:<repo> --branch aw/AW-1 --no-parent --setup skip --json`              |
| `worktree-list.json`                     | `worktree list --repo id:<repo> --json`                                                                              |
| `terminal-list-first.json`               | `terminal list --worktree id:<worktree> --json`: the first terminal that `worktree create` opens                     |
| `terminal-close-all.json`                | `terminal close --worktree id:<worktree> --all --json`                                                               |
| `terminal-create.json`                   | `terminal create --worktree id:<worktree> --title aw-<task-id> --command "exec env AW_HOME='...' '<script>'" --json` |
| `terminal-create-exit.json`              | `terminal create ... --command "exec sh -c 'exit 3'"`                                                                |
| `terminal-show-live.json`                | `terminal show --terminal <handle> --json` while the program runs                                                    |
| `terminal-show-signaled.json`            | the same after `kill -TERM -<pgid>`                                                                                  |
| `terminal-show-exited.json`              | the same after `exit 3`                                                                                              |
| `terminal-show-closed.json`              | the same after `terminal close`                                                                                      |
| `terminal-show-stale.json`               | `terminal show` of an unknown handle                                                                                 |
| `terminal-show-down.json`                | `terminal show` while the runtime does not run                                                                       |
| `terminal-list.json`                     | `terminal list --json`                                                                                               |
| `terminal-send-unsupported.json`         | `terminal send --text <2 lines> --enter --wait-submit 3 --json` to a program that is not a known agent               |
| `terminal-send-not-writable.json`        | `terminal send` to a killed terminal (`terminal_not_writable` with `orchestrationRequestId`)                         |
| `terminal-close.json`                    | `terminal close --terminal <handle> --json`                                                                          |
| `worktree-rm.json`                       | `worktree rm --worktree id:<worktree> --force --delete-branch --json`                                                |
| `setup-delete.json`                      | `project setup-delete --setup <repo> --force --json`                                                                 |

Not captured: a failure after which Orca cannot tell if it sent the text. The tests take `terminal-send-not-writable.json` and change only `error.code` to `transport_timeout` for it.
