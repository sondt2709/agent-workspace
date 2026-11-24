## ADDED Requirements

### Requirement: Root holds only repo-wide files
The repository root SHALL have no source code and no tool config file of one language (`docs/decisions/2026-11-23-repo-layout.md`). The root SHALL keep only: `.github/`, `docs/`, `openspec/`, `scripts/`, the deliverable folders (`contracts/`, `daemon/`, `shared/`, `plugins/`, `e2e/`, later `android/` and `desktop/`), `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.nvmrc`, `Taskfile.yaml`, `AGENTS.md`, `CLAUDE.md`, `README.md`, `LICENSE`, `SECURITY.md`, `.editorconfig`, `.gitattributes`, `.gitignore`, `.gitleaks.toml`, `.pre-commit-config.yaml` and `.prettierignore`. The root `package.json` SHALL have no dependencies; its only tool setting SHALL be the `prettier` key that names the shared Prettier config.

#### Scenario: Root listing
- **WHEN** a contributor lists the root of a clean clone
- **THEN** each entry is in the list above

#### Scenario: Root manifest
- **WHEN** the `repo` test project reads the root `package.json`
- **THEN** it has no `dependencies` and no `devDependencies`

### Requirement: Shared TypeScript tool config
`shared/config` (`@aw/config`) SHALL hold `tsconfig.base.json`, the ESLint preset `eslint.js` and the Prettier config `prettier.js`. Each TypeScript package SHALL extend `@aw/config/tsconfig.base.json`, export the ESLint preset from its own `eslint.config.js`, name `@aw/config/prettier` in the `prettier` key of its `package.json`, and list its tools (`typescript`, `eslint`, `prettier`, `vitest`) as devDependencies from the pnpm catalog. Each TypeScript package SHALL have the scripts `format`, `format:check`, `lint`, `typecheck` and `test`.

#### Scenario: Check one package alone
- **WHEN** a contributor runs `pnpm lint`, `pnpm typecheck` and `pnpm test` in `daemon/`
- **THEN** each command uses the tools of `daemon/` and the config of `shared/config`, and passes

#### Scenario: Manifest scripts
- **WHEN** a workspace package has no `test` script
- **THEN** the `repo` test project fails and names the package

## MODIFIED Requirements

### Requirement: Final workspace layout
The repository SHALL have one workspace package in each of these folders: `daemon`, `shared/config`, `shared/schema`, `shared/core`, `shared/plugin-api`, `shared/client`, `shared/ui`, `plugins/agent-claude`, `plugins/host-tmux`, `plugins/host-orca`, `plugins/sync-syncthing`, `plugins/kb-files`, `plugins/push-webpush`, `plugins/live-direct`, `e2e` and `scripts`. Each package manifest SHALL have the name `@aw/<last folder name>`, the version `0.0.0`, `private: true` and `type: module`. `contracts/` SHALL hold the language-neutral contract and SHALL NOT be a package: `contracts/schemas/` (generated JSON Schemas), `contracts/openapi.yaml`, `contracts/fixtures/` and `contracts/test-vectors/`.

#### Scenario: Manifest rules
- **WHEN** the `repo` test project runs
- **THEN** it fails for each workspace package that has another name pattern, another version, no `private: true` or no `type: module`

#### Scenario: Typecheck and tests cover each package
- **WHEN** a contributor runs `pnpm typecheck` and `pnpm test`
- **THEN** `tsc` checks each package and Vitest runs the tests of each package

### Requirement: One local check command
`task check` SHALL run these checks in sequence and stop at the first failure: the YAML extension check, the `check` task of `scripts/` (Prettier check of the repo-wide files and the repo tests), the `check` task of each TypeScript folder (`shared`, `daemon`, `plugins`, `e2e`: the Prettier check, ESLint with `--max-warnings 0`, the typecheck and the tests of its packages) and the leak check.

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

### Requirement: Generated schemas stay current in CI
The CI job `node` SHALL run `pnpm schema:generate`, then fail when `git status --porcelain` shows a change, so that the generated JSON Schemas in `contracts/schemas/` always match the zod schemas. It SHALL do the same check for `pnpm api:generate` and `contracts/openapi.yaml`.

#### Scenario: Stale generated file
- **WHEN** a pull request changes a zod schema and does not commit the new generated file
- **THEN** the CI step "Generated schemas are current" fails and prints the changed file
