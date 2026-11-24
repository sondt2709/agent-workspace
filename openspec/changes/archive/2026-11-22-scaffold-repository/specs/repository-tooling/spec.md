## ADDED Requirements

### Requirement: Pinned toolchain
The repository SHALL pin Node in `.nvmrc`, pnpm in the `packageManager` field of the root `package.json`, and each dependency at an exact version in `pnpm-lock.yaml`. pnpm SHALL refuse a release younger than 7 days (`minimumReleaseAge: 10080`).

#### Scenario: Install from a clean clone
- **WHEN** a contributor runs `pnpm install --frozen-lockfile` in a new clone
- **THEN** pnpm installs the locked versions and does not change `pnpm-lock.yaml`

#### Scenario: Dependency younger than 7 days
- **WHEN** a contributor adds a dependency version that is younger than 7 days
- **THEN** pnpm refuses the install and names the package and its publish date

### Requirement: Final workspace layout
The repository SHALL have one workspace package in each of these folders: `apps/daemon`, `packages/schema`, `packages/core`, `packages/plugin-api`, `packages/client`, `packages/ui`, `plugins/agent-claude`, `plugins/host-tmux`, `plugins/host-orca`, `plugins/sync-syncthing`, `plugins/kb-files`, `plugins/push-webpush`, `plugins/live-direct` and `test/e2e`. Each package manifest SHALL have the name `@aw/<folder>`, the version `0.0.0`, `private: true` and `type: module`.

#### Scenario: Manifest rules
- **WHEN** the `repo` test project runs
- **THEN** it fails for each workspace package that has another name pattern, another version, no `private: true` or no `type: module`

#### Scenario: Typecheck and tests cover each package
- **WHEN** a contributor runs `pnpm typecheck` and `pnpm test`
- **THEN** `tsc` checks each package and Vitest runs the tests of each package

### Requirement: One local check command
`task check` SHALL run these checks in sequence and stop at the first failure: the YAML extension check, the Prettier check, ESLint with `--max-warnings 0`, the typecheck, the tests and the leak check.

#### Scenario: All checks pass
- **WHEN** the tree has no problem
- **THEN** `task check` exits with code 0

#### Scenario: A check fails
- **WHEN** the tree has a lint error, a type error, a failing test, a `*.yml` file or a token-shaped string
- **THEN** `task check` exits with a code that is not 0 and names the failing check

#### Scenario: Local agent files and other worktrees
- **WHEN** `.claude/worktrees/<name>/` has a TypeScript file of another branch
- **THEN** `pnpm lint` and `pnpm format:check` do not check it, and pass

### Requirement: YAML files use the .yaml extension
The pre-commit hook `no-yml-extension` and the CI step "YAML files use the .yaml extension" SHALL reject each file with the `.yml` extension.

#### Scenario: A .yml file is added
- **WHEN** a contributor adds `example.yml`
- **THEN** `scripts/check-yaml-ext.sh` exits with code 1 and prints "Rename to .yaml:" and the file name

### Requirement: Leak check
`scripts/leakcheck.sh` SHALL scan the tracked and the untracked files that git does not ignore, also itself and each file with a non-ASCII character, a double quote or a backslash in its name. It SHALL check each file in full, and each match on a line. Only a file with a NUL byte is binary and skipped. The result SHALL be the same with BSD grep and GNU grep. It SHALL fail when it cannot read a listed file. It SHALL report home paths (also Windows paths), email addresses other than noreply and `example.com` addresses, token shapes and private key headers. It SHALL also report the terms of a private terms file when that file exists: `AW_LEAKCHECK_TERMS`, else `tmp/leakcheck.local`.

#### Scenario: A token in a file
- **WHEN** a file contains a string with the shape of a GitHub token
- **THEN** the script prints the file, the line and "possible secret", and exits with code 1

#### Scenario: No private terms file
- **WHEN** no private terms file exists
- **THEN** the script runs the generic checks and says that it did not check private terms

#### Scenario: A token at the end of a large file
- **WHEN** a file larger than 64 KB has a token-shaped string on its last line
- **THEN** the script reports that line and exits with code 1 on each run

#### Scenario: A real path next to a placeholder path
- **WHEN** one line has `/Users/you/aw` and a home path with a real user name
- **THEN** the script reports the line as "home path"

#### Scenario: A file name that git quotes
- **WHEN** a file named `tài-liệu.txt` or `with"quote.txt` has a home path or an email address
- **THEN** the script reports that file and exits with code 1, also when the file is staged and in the range of a push

#### Scenario: A text file that is not valid UTF-8
- **WHEN** a Latin-1 text file has a home path and the locale is `C.UTF-8`
- **THEN** the script reports the line as "home path"

#### Scenario: A file that cannot be read
- **WHEN** a listed file has mode `000`
- **THEN** the script prints the file and "cannot read the file", and exits with code 1

### Requirement: Git hooks
`.pre-commit-config.yaml` SHALL install the hooks for pre-commit, commit-msg and pre-push. The hooks SHALL run the standard file checks, gitleaks, Prettier, ESLint, the YAML extension check and the Conventional Commits message check. The pre-push stage SHALL run the typecheck and the leak check.

#### Scenario: All hooks on a clean tree
- **WHEN** a contributor runs `pre-commit run --all-files`
- **THEN** each hook passes

### Requirement: CI checks workflow
`.github/workflows/ci.yaml` SHALL run the repository rules, the Node checks on ubuntu and macOS with Node 24 and 26, the dependency audit and the gitleaks scan of the full history. One job named "CI OK" SHALL fail when one of these jobs fails. Each third-party action SHALL be pinned by commit SHA. The workflow SHALL have no release job.

#### Scenario: Workflow syntax
- **WHEN** a contributor runs actionlint on `.github/workflows/*.yaml`
- **THEN** actionlint reports no problem

#### Scenario: One job fails
- **WHEN** one needed job fails
- **THEN** the "CI OK" job fails

### Requirement: PR title check
`.github/workflows/pr-title.yaml` SHALL accept only a Conventional Commits title with the types `feat`, `fix`, `perf`, `revert`, `refactor`, `docs`, `test`, `chore`, `ci` and `build`, an optional lower-case scope, an optional `!`, and 100 characters or fewer in total.

#### Scenario: Title without a type
- **WHEN** a pull request has the title "Add the scaffold"
- **THEN** the "PR title" check fails and prints the allowed types
