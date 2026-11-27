## ADDED Requirements

### Requirement: Open in the project checkout
`open()` SHALL open the terminal in any folder that Orca knows, also the main folder of a repo. When `terminal create` gives the error `selector_not_found` for `path:<cwd>`, the host SHALL run `repo add --path <cwd>` one time and then `terminal create` again. When `repo add` fails, `open()` SHALL fail with the Orca message. The host SHALL never remove the main folder of a repo, and `list()` SHALL keep only the terminals of `aw-` folders. The fake Orca CLI SHALL answer `selector_not_found` for an unknown path, as the real Orca does (capture of inbox2agent, 2026-10-28), and SHALL open a terminal in the main folder of a known repo.

#### Scenario: Unknown checkout
- **WHEN** Orca does not know the checkout `/work/billing-api` and AW opens a session there
- **THEN** the host runs `terminal create`, then `repo add --path /work/billing-api`, then `terminal create` again, and the session runs in the main folder

#### Scenario: Orca refuses the folder
- **WHEN** `repo add` gives "Not a valid git repository"
- **THEN** `open()` fails with that message, and the task gets the start comment
