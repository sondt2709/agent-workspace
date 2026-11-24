## 1. Baseline

- [x] 1.1 Run `task check` on `ffdfa7a` in a clean clone. Record the test count (483) and the Vitest JSON report.
- [x] 1.2 Record the Prettier file list and the resolved package list of `pnpm-lock.yaml` on `ffdfa7a`.

## 2. Move the folders

- [x] 2.1 `git mv apps/daemon daemon`, `git mv packages/<name> shared/<name>` for schema, core, plugin-api, client and ui, `git mv test/e2e e2e`.
- [x] 2.2 `git mv` the generated schemas to `contracts/schemas/`, the fixtures to `contracts/fixtures/`, the test vectors to `contracts/test-vectors/`, `docs/api.yaml` to `contracts/openapi.yaml`.
- [x] 2.3 `git mv tsconfig.base.json shared/config/`, `git mv .prettierrc.json shared/config/prettier.js` (a JS module: see design decision 3), `git mv eslint.config.js shared/config/eslint.js`. Remove the root `tsconfig.json` and `vitest.config.ts`.

## 3. Tool config

- [x] 3.1 Create `shared/config/package.json` (`@aw/config`) with the exports and the tool dependencies; make `eslint.js` a `config(rootDir)` function.
- [x] 3.2 Add the pnpm catalog to `pnpm-workspace.yaml` and the new workspace globs.
- [x] 3.3 In each TypeScript package: `tsconfig.json` extends `@aw/config/tsconfig.base.json`, add `eslint.config.js`, the `prettier` key, the devDependencies and the 5 scripts.
- [x] 3.4 Make `scripts/` the package `@aw/scripts` with its config files and the repo-wide Prettier check.
- [x] 3.5 Root `package.json`: scripts only, plus the `prettier` key. Run `pnpm install` and check that the resolved package list did not change.

## 4. Paths in code and tests

- [x] 4.1 `shared/schema`: the generator writes `contracts/schemas/`; `generatedSchemasDir`, the fixture roots and the HLC test vector path read `contracts/`.
- [x] 4.2 `daemon`: `API_YAML_PATH` is `contracts/openapi.yaml`; update the comments, the unit test paths and the API description text; run `pnpm api:generate`.
- [x] 4.3 `shared/core/scripts/merge-expected.ts` and the fixture README name the new paths.
- [x] 4.4 `scripts/workspace.test.ts`: the new folders, the script check, the root manifest test.

## 5. Repo files

- [x] 5.1 Taskfiles: one per TypeScript folder (`shared`, `daemon`, `plugins`, `e2e`, `scripts`) and the root `check` that calls them.
- [x] 5.2 `.pre-commit-config.yaml`, `.gitattributes`, `.gitleaks.toml`, `.prettierignore`, `.github/CODEOWNERS`, `.github/workflows/ci.yaml`.
- [x] 5.3 OpenSpec main specs: the Purpose lines that name the old paths.
- [x] 5.4 Docs: `docs/phase-1.md` 11 and the other paths, `docs/tech-stack.md`, `docs/architecture.md`, `docs/engineering-rules.md`, `AGENTS.md`, `CLAUDE.md`, `README.md`.

## 6. Verify

- [x] 6.1 `task check` passes; the test count is 486 and the 483 old test names pass.
- [x] 6.2 `pnpm schema:generate` and `pnpm api:generate` leave the tree clean; a schema change makes the drift tests fail.
- [x] 6.3 The awd process tests in `daemon/src/e2e` pass.
- [x] 6.4 The root listing matches the decision; `git log --follow` works for a moved file.
- [x] 6.5 pre-commit, actionlint, gitleaks and the leak check pass.
