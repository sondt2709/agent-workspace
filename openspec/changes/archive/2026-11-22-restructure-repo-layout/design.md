## Context

At `ffdfa7a` the root is a TypeScript project: `tsconfig.json`, `tsconfig.base.json`, `eslint.config.js`, `vitest.config.ts`, `.prettierrc.json` and all tool dependencies are at the root. The code is in `apps/daemon`, `packages/*`, `plugins/*` and `test/e2e`. The generated JSON Schemas, the shared fixtures and the HLC test vectors are in `packages/schema`, and the OpenAPI file is `docs/api.yaml`. One `vitest run` at the root runs 483 tests in 38 files.

The product owner accepted `docs/decisions/2026-11-23-repo-layout.md`: one folder per deliverable, the root keeps only repo-wide files, TypeScript tool config lives in `shared/config`, the root `package.json` has only scripts, and the root `Taskfile.yaml` calls each folder.

## Goals / Non-Goals

**Goals:**
- The layout of the decision: `contracts/`, `daemon/`, `shared/`, `plugins/`, `e2e/` (and `android/` later).
- The root has no source code and no tool config of one language.
- Each TypeScript package can run its own checks (`cd daemon && pnpm lint`).
- The same tests run and pass: 483 tests before, the same tests after.
- `git log --follow` works for each moved file.

**Non-Goals:**
- No product code change, no dependency version change.
- No move of `apps/android` (it is not on this branch; the lead moves it when it integrates android-shared).
- No move of the awd process tests out of `daemon/src/e2e` into `e2e/`.

## Decisions

1. **Folder map.**
   ```
   apps/daemon                    → daemon/
   packages/{schema,core,plugin-api,client,ui} → shared/{...}
   (new)                          → shared/config        @aw/config
   test/e2e                       → e2e/
   plugins/*                      → plugins/*            (no change)
   packages/schema/generated/schemas → contracts/schemas/
   packages/schema/fixtures       → contracts/fixtures/
   packages/schema/test-vectors   → contracts/test-vectors/
   docs/api.yaml                  → contracts/openapi.yaml
   scripts/                       → scripts/             now also package @aw/scripts
   ```
   `contracts/` is not a pnpm package. It holds data only. The TypeScript code reads it through relative paths from `shared/schema` and `daemon`, and the Kotlin tests will read it from `android/`. The package names stay `@aw/<last folder name>`, so no import changes.

2. **Each package has its own toolchain.** A pnpm package can run only the binaries of its direct dependencies. The root has no dependencies (decision rule 2), so each TypeScript package lists its tools as devDependencies: `@aw/config`, `typescript`, `eslint`, `prettier`, `vitest`, `@types/node`. A pnpm `catalog:` in `pnpm-workspace.yaml` holds the version of each shared tool once, so all packages use the same version. The versions are the versions of `ffdfa7a`.
   - Alternative: keep the tool dependencies in the root `package.json`. Rejected: the decision allows only scripts in the root manifest.
   - Alternative: `@aw/config` gives wrapper binaries. Rejected: more code, and pnpm does not link the binaries of indirect dependencies.

3. **`shared/config` (`@aw/config`).**
   - `tsconfig.base.json`: moved with `git mv`, content unchanged. Each package `tsconfig.json` extends `@aw/config/tsconfig.base.json`, includes `eslint.config.js` and sets `allowJs` and `checkJs` for it (the root `tsconfig.json` did this for the root config files).
   - `eslint.js`: `config(rootDir)` returns the flat config of the old root `eslint.config.js`, with `tsconfigRootDir: rootDir`. Each package has `eslint.config.js` with `export default config(import.meta.dirname)`. ESLint 10 finds the config from the folder of each linted file, so the pre-commit hook can lint files of many packages in one run from the root.
   - `prettier.js`: the old `.prettierrc.json` as a JS module. Prettier finds a plugin by its name from the folder that it formats, not from the folder of the config, and only `shared/config` has `prettier-plugin-organize-imports`. A JSON config failed in `e2e/` with "Cannot find package 'prettier-plugin-organize-imports'". The JS config gives the plugin as an absolute path from `import.meta.resolve`. Each package `package.json` has `"prettier": "@aw/config/prettier"`. The root `package.json` has `"prettier": "./shared/config/prettier.js"`, so the repo-wide files (`.github/`, `contracts/`, `openspec/`, root YAML and JSON) and the editors use the same rules. This one key is the smallest root config that Prettier can find; a root file is not needed.
   - No Vitest preset. The old root `vitest.config.ts` had only the project list and no shared option. With one Vitest run in each package, Vitest needs no config file. A package without tests runs `vitest run --passWithNoTests`, so its first test runs with no script change.

4. **Package scripts.** Each TypeScript package has `format`, `format:check`, `lint`, `typecheck` and `test`. The root scripts call them: `pnpm -r run <script>`. Tests run with `--workspace-concurrency=1`: the awd process tests start child processes, and one package at a time keeps the load near the old single run.

5. **`scripts/` is the package `@aw/scripts`.** The repo tests (`leakcheck.test.ts`, `workspace.test.ts`) need Vitest and `tsc`. The package also runs the Prettier check of the repo-wide files (`.github/`, `contracts/`, `docs/`, `openspec/`, the root JSON and YAML files) with the root `.prettierignore`. Alternative: put the repo tests in `shared/config`; rejected, because they test the repository, not the config.

6. **Taskfiles.** Each TypeScript folder has a `Taskfile.yaml` with one `check` task: format check, lint, typecheck and test of the packages in that folder (`pnpm --filter "./shared/*"`; pnpm reads the path from the workspace root). The root `Taskfile.yaml` includes `shared`, `daemon`, `plugins`, `e2e` and `scripts`, and `task check` runs: `rules`, `scripts:check`, `shared:check`, `daemon:check`, `plugins:check`, `e2e:check`, `leakcheck`. The order stops at the first failure, as before. The android task adds `android:check`.

7. **Root files that stay.** `.prettierignore` stays at the root: the pre-commit Prettier hook runs from the root, and Prettier reads the ignore file only from the current folder. `.gitignore` stays (repo-wide by nature). The pre-commit hooks call `shared/config/node_modules/.bin/prettier` and `.../eslint`, because the root has no binaries.

8. **Generators write into `contracts/`.** `shared/schema/scripts/render.ts` writes `contracts/schemas/`; `generatedSchemasDir` points there. `daemon/src/api/openapi.ts` writes `contracts/openapi.yaml`. The tests that compare the files read the same paths. The CI drift steps check `contracts/schemas` and `contracts/openapi.yaml`.

9. **History.** All moves use `git mv` in one commit. Files with no content change are exact renames, so `git log --follow` finds their history. Small config files with changed content may lose the rename link; that is accepted.

10. **Test count.** The repo test "follows the manifest rules" runs once per workspace package. The 2 new packages (`@aw/config`, `@aw/scripts`) add 2 cases. One new repo test checks that the root `package.json` has no dependencies. Thus the expected count is 483 + 3 = 486, and each of the 483 old tests has the same name and passes after the move. The new check that each package has the 5 scripts goes into the existing "follows the manifest rules" test and adds no test.

## Risks / Trade-offs

- [More devDependencies in each package] → One version in the pnpm catalog. The lockfile resolution stays the same; the evidence compares the resolved package list before and after.
- [Per-package lint and tests are slower than one run] → Lint runs in parallel; tests run one package at a time. The time is recorded in the evidence.
- [Prettier could check fewer files after the move] → The evidence compares the list of checked files before and after.
- [`generatedSchemasDir` reads `contracts/` at run time through a relative path] → It works in the repository. A published npm package must copy `contracts/schemas/`; release-pipeline handles it (open issue).
- [Parallel task branches use the old paths] → The plan lead restarts or rebases them on the new layout.

## Migration Plan

1. One commit on `task/repo-layout`. The lead fast-forwards `feat/phase-1`.
2. A clone runs `pnpm install` again (the importer paths change).
3. Rollback: revert the commit.

## Open Questions

(none)
