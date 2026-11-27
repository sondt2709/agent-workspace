# Orca CLI replies (orca 1.4.240)

Source: real replies of the `orca` CLI 1.4.240, captured on 2026-10-28 from a real Orca install. Local paths are replaced with `/home/user`.

| File                      | Command                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------- |
| `selector-not-found.json` | `agent launch --worktree path:<folder> --json` for a folder that Orca does not know |
| `repo-add-not-git.json`   | `repo add --path <folder> --json` for a folder that is not a git repository         |

The selector of `terminal create --worktree path:<folder>` uses the same resolver: the fake Orca CLI gives this `selector_not_found` reply for an unknown path.
