# repository-tooling Specification

## Purpose
The workspace layout, the pinned toolchain, the local check command, the git hooks, the leak check and the CI checks. Each machine and CI run the same checks before a change reaches `main`.
## Requirements
### Requirement: Pinned toolchain
The repository SHALL pin Node in `.nvmrc`, pnpm in the `packageManager` field of the root `package.json`, and each dependency at an exact version in `pnpm-lock.yaml`. pnpm SHALL refuse a release younger than 7 days (`minimumReleaseAge: 10080`).

#### Scenario: Install from a clean clone
- **WHEN** a contributor runs `pnpm install --frozen-lockfile` in a new clone
- **THEN** pnpm installs the locked versions and does not change `pnpm-lock.yaml`

#### Scenario: Dependency younger than 7 days
- **WHEN** a contributor adds a dependency version that is younger than 7 days
- **THEN** pnpm refuses the install and names the package and its publish date

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

### Requirement: Generated schemas stay current in CI
The CI job `node` SHALL run `pnpm schema:generate`, then fail when `git status --porcelain` shows a change, so that the generated JSON Schemas in `contracts/schemas/`, the schema samples in `contracts/samples/` and the Kotlin classes in `android/shared/generated/` always match the zod schemas. It SHALL do the same check for `pnpm api:generate` and `contracts/openapi.yaml`.

#### Scenario: Stale generated file
- **WHEN** a pull request changes a zod schema and does not commit the new generated file
- **THEN** the CI step "Generated schemas are current" fails and prints the changed file

### Requirement: Root holds only repo-wide files
The repository root SHALL have no source code and no tool config file of one language (`docs/decisions/2026-11-23-repo-layout.md`). The root SHALL keep only: `.github/`, `docs/`, `openspec/`, `scripts/`, the deliverable folders (`contracts/`, `daemon/`, `shared/`, `plugins/`, `e2e/`, `android/`, later `desktop/`), `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.nvmrc`, `Taskfile.yaml`, `AGENTS.md`, `CLAUDE.md`, `README.md`, `LICENSE`, `SECURITY.md`, `.editorconfig`, `.gitattributes`, `.gitignore`, `.gitleaks.toml`, `.pre-commit-config.yaml` and `.prettierignore`. The root `package.json` SHALL have no dependencies; its only tool setting SHALL be the `prettier` key that names the shared Prettier config.

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

### Requirement: Android checks
`task android:check` SHALL run, in `android/`, the Spotless check (ktlint `ktlint_official`), detekt and the JVM tests of `:shared`, `:identity`, `:engine` and `:control`, each with 0 findings allowed. detekt SHALL also check the source of `:app` without type resolution, so the check needs no Android SDK. The CI job `android` SHALL run the same Gradle tasks on the JDK 21 toolchain when a change touches `android/**`, `shared/schema/**`, `contracts/**`, `plugins/sync-syncthing/engine/**` (the engine pins that the Android tests compare) or the workflow file, and SHALL be skipped otherwise; "CI OK" accepts a skipped job. The root `task check` SHALL run `task android:check`. A pre-commit hook SHALL run the ktlint check on staged Kotlin files. `task android:lint` SHALL run Android Lint (it needs the Android SDK) on the Android target of `:shared`, `:identity`, `:engine` and `:control` (the `com.android.lint` plugin of AGP) and on `:app`, with warnings as errors, so a call of a Java API above `minSdk` (`NewApi`) fails before the app runs on a phone.

#### Scenario: Java API that the phone lacks
- **WHEN** code of `:control` calls `java.nio.file.Files.readString`
- **THEN** `task android:lint` fails with `NewApi` and names the file

#### Scenario: ktlint finding
- **WHEN** a Kotlin file of `android/` breaks a ktlint rule
- **THEN** `task android:check` fails and names the file and the rule

#### Scenario: detekt finding
- **WHEN** a Kotlin file of `android/` has a detekt finding
- **THEN** `task android:check` fails and names the file and the rule

#### Scenario: Change outside the Android paths
- **WHEN** a pull request changes only `daemon/**`
- **THEN** the job `android` is skipped and "CI OK" passes

#### Scenario: No Android SDK
- **WHEN** `task android:check` runs on a computer with a JDK 21 and no Android SDK
- **THEN** the check runs the JVM tests of `:shared`, `:identity`, `:engine` and `:control` and lints `:app`, and passes
