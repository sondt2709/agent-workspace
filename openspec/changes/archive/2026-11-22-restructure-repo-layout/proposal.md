## Why

The product owner rejected the layout of `docs/phase-1.md` 11: the root was a TypeScript project, with code in `apps/`, `packages/`, `test/` and the tool config at the root. The accepted decision `docs/decisions/2026-11-23-repo-layout.md` asks for one folder per deliverable and a root with only repo-wide files. The move must happen now, before the parallel tasks add more code to the old folders.

## What Changes

- Move the folders with `git mv`, so that git keeps the history:
  - `apps/daemon` → `daemon/`.
  - `packages/{schema,core,plugin-api,client,ui}` → `shared/{...}`.
  - `test/e2e` → `e2e/`.
  - `plugins/*` stay in `plugins/`.
- Move the language-neutral contract out of `packages/schema` into `contracts/`:
  - `contracts/schemas/` gets the generated JSON Schemas.
  - `contracts/fixtures/` and `contracts/test-vectors/` get the fixtures and the test vectors.
  - `docs/api.yaml` → `contracts/openapi.yaml`.
- `pnpm schema:generate` and `pnpm api:generate` write into `contracts/`.
- New package `shared/config` (`@aw/config`) holds the TypeScript tool config: `tsconfig.base.json`, the ESLint preset (`eslint.js`) and the Prettier config (`prettier.js`). Each TypeScript package gets small config files that use it. Each package has its own tool dependencies and its own scripts (`format`, `format:check`, `lint`, `typecheck`, `test`).
- New package `scripts/` (`@aw/scripts`) runs the repo-wide tests (`leakcheck.test.ts`, `workspace.test.ts`) and the Prettier check of the repo-wide files.
- Root cleanup:
  - The root `package.json` keeps only the workspace manifest and scripts that call the folders. It has no dependencies.
  - The root `tsconfig.json`, `tsconfig.base.json`, `eslint.config.js`, `vitest.config.ts` and `.prettierrc.json` go away.
  - The root `.prettierignore` stays, because the pre-commit Prettier hook runs from the root.
- `Taskfile.yaml`: the root `task check` calls the `check` task of each folder (`shared`, `daemon`, `plugins`, `e2e`) and the repo checks.
- Update each path: the pnpm workspace globs, the tsconfig `extends`, the code paths to the contract files, the pre-commit config, the CI workflow, CODEOWNERS, `.gitattributes`, `.gitleaks.toml`, the OpenSpec specs and the docs.
- No product behavior changes. No dependency version changes.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `repository-tooling`: the workspace folders, the per-folder check in `task check`, the tool config in `shared/config`, and the CI drift check path `contracts/schemas/`.
- `workspace-schemas`: the generated JSON Schemas, the HLC test vectors and the shared fixtures move to `contracts/`.
- `local-api`: the OpenAPI file moves from `docs/api.yaml` to `contracts/openapi.yaml`.
- `awd-service`: the settings module path is `daemon/src/settings.ts`, the files layer is in `shared/core`, and the schema files come from `contracts/schemas/`.

## Impact

- Each import between packages stays the same (`@aw/<name>`). Relative paths to the contract files change in `shared/schema` and `daemon`.
- `pnpm-lock.yaml`: the importer paths change, and each package gets its tool dependencies. The resolved versions stay the same.
- The tasks that run in parallel (android-shared) and the tasks that start later use the new paths. The lead moves `apps/android` to `android/` when it integrates android-shared.
- The generated `contracts/openapi.yaml` has one changed line: its description names `daemon/` instead of `apps/daemon`.
- Undo: revert the one commit.
