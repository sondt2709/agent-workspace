## 1. Root workspace and toolchain

- [x] 1.1 Add `.nvmrc` (24.22.3), the root `package.json` (private, `0.0.0`, `packageManager`, `engines`, scripts) and `pnpm-workspace.yaml` (packages, `minimumReleaseAge: 10080`)
- [x] 1.2 Add `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`, NodeNext, ES2022) and the root `tsconfig.json` for the root config files
- [x] 1.3 Add `eslint.config.js` (typescript-eslint `recommendedTypeChecked`, `projectService`) and the `lint` script with `--max-warnings 0`
- [x] 1.4 Add `.prettierrc.json` (double quotes, width 100, trailing commas, organize-imports) and `.prettierignore`
- [x] 1.5 Add `vitest.config.ts` with one project for each workspace folder and the `repo` project
- [x] 1.6 Install the pinned dev dependencies and commit `pnpm-lock.yaml`
- [x] 1.7 Add `node_modules/`, `tmp/`, `dist/`, `coverage/` and `*.tsbuildinfo` to `.gitignore`

## 2. Workspace packages

- [x] 2.1 Add `apps/daemon` and the 5 packages in `packages/` with `package.json`, `tsconfig.json`, `src/index.ts` and `src/index.test.ts`
- [x] 2.2 Add the 7 plugins in `plugins/` with the same files
- [x] 2.3 Add `test/e2e` with the same files
- [x] 2.4 Add `scripts/workspace.test.ts` that checks the rules of each workspace manifest

## 3. Repository rules and hooks

- [x] 3.1 Add `.editorconfig`, `.gitattributes` and `.gitleaks.toml` from the drafts
- [x] 3.2 Add `scripts/leakcheck.sh` with the optional private terms file (`AW_LEAKCHECK_TERMS`, else `tmp/leakcheck.local`)
- [x] 3.3 Add `scripts/check-yaml-ext.sh`
- [x] 3.4 Add `.pre-commit-config.yaml` adapted to the real folders (no ktlint hook yet)
- [x] 3.5 Add `Taskfile.yaml` with `check`, `test`, `lint`, `typecheck`, `format`, `format:check`, `leakcheck` and `rules`
- [x] 3.6 Fix the 4 faults of the draft leak check (large files, mixed paths, Windows paths, binary files) and add `scripts/leakcheck.test.ts`; see the tests fail on the draft
- [x] 3.7 Fix the code review faults of the leak check (quoted file names, unreadable files, the locale of grep, the skipped script) and add tests that fail on the first version
- [x] 3.8 Ignore `.claude/` in ESLint and Prettier

## 4. GitHub files

- [x] 4.1 Add `.github/CODEOWNERS` with `@aw-maintainers` for the paths that exist
- [x] 4.2 Add `.github/pull_request_template.md` with the current commands
- [x] 4.3 Add `.github/workflows/ci.yaml` (checks only, "CI OK", actions pinned by commit SHA)
- [x] 4.4 Add `.github/workflows/pr-title.yaml`

## 5. Documents

- [x] 5.1 Add `LICENSE` (MIT, "The agent-workspace authors")
- [x] 5.2 Add `SECURITY.md` with the threat model skeleton
- [x] 5.3 Write `README.md`: what AW is, the status, how to build
- [x] 5.4 Update `AGENTS.md`: remove "planned" from the commands that now exist

## 6. Verification

- [x] 6.1 Run `task check` and see it pass
- [x] 6.2 Add a lint error, a type error, a failing test, a `.yml` file and a fake secret one at a time; see each check fail; restore
- [x] 6.3 Run `pre-commit run --all-files`, actionlint on the workflows and `gitleaks git --no-banner`
- [x] 6.4 Run `pnpm install --frozen-lockfile` and `task check` in a clean clone of the commit
