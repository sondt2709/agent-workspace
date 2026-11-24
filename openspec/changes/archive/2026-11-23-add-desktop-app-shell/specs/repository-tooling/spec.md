## MODIFIED Requirements

### Requirement: Final workspace layout
The repository SHALL have one workspace package in each of these folders: `daemon`, `desktop`, `shared/config`, `shared/schema`, `shared/core`, `shared/plugin-api`, `shared/client`, `shared/ui`, `plugins/agent-claude`, `plugins/host-tmux`, `plugins/host-orca`, `plugins/sync-syncthing`, `plugins/kb-files`, `plugins/push-webpush`, `plugins/live-direct`, `e2e` and `scripts`. Each package manifest SHALL have the name `@aw/<last folder name>`, the version `0.0.0`, `private: true` and `type: module`. `contracts/` SHALL hold the language-neutral contract and SHALL NOT be a package: `contracts/schemas/` (generated JSON Schemas), `contracts/openapi.yaml`, `contracts/fixtures/` and `contracts/test-vectors/`.

#### Scenario: Manifest rules
- **WHEN** the `repo` test project runs
- **THEN** it fails for each workspace package that has another name pattern, another version, no `private: true` or no `type: module`

#### Scenario: Typecheck and tests cover each package
- **WHEN** a contributor runs `pnpm typecheck` and `pnpm test`
- **THEN** `tsc` checks each package and Vitest runs the tests of each package

### Requirement: One local check command
`task check` SHALL run these checks in sequence and stop at the first failure: the YAML extension check, the `check` task of `scripts/` (Prettier check of the repo-wide files and the repo tests), the `check` task of each TypeScript folder (`shared`, `daemon`, `desktop`, `plugins`, `e2e`: the Prettier check, ESLint with `--max-warnings 0`, the typecheck and the tests of its packages; `desktop` also builds the app with electron-vite) and the leak check.

#### Scenario: All checks pass
- **WHEN** the tree has no problem
- **THEN** `task check` exits with code 0

#### Scenario: A check fails
- **WHEN** the tree has a lint error, a type error, a failing test, a `*.yml` file or a token-shaped string
- **THEN** `task check` exits with a code that is not 0 and names the failing check

#### Scenario: Local agent files and other worktrees
- **WHEN** `.claude/worktrees/<name>/` has a TypeScript file of another branch
- **THEN** `pnpm lint` and `pnpm format:check` do not check it, and pass

#### Scenario: Check one folder
- **WHEN** a contributor runs `task check` in `daemon/`
- **THEN** only the checks of `daemon/` run
