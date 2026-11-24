## Why

The repository has documents and OpenSpec only. Each later phase 1 task needs the final folder layout, a pinned toolchain and the same checks on each machine and in CI.

## What Changes

- Add a pnpm TypeScript monorepo at the root: `package.json`, `pnpm-workspace.yaml`, `.nvmrc`, `tsconfig.base.json`, ESLint, Prettier and Vitest configuration.
- Pin the toolchain: Node 24.22.3 in `.nvmrc`, pnpm through corepack in `packageManager`, exact versions for each tool, and `minimumReleaseAge` of 7 days.
- Add one minimal package in each folder of the final layout: `apps/daemon`, 5 packages in `packages/`, 7 plugins in `plugins/`, and `test/e2e`. Each package has a placeholder export and one test.
- Add `Taskfile.yaml`. `task check` runs the YAML extension check, the format check, lint, typecheck, the tests and the leak check.
- Add the repository rules from the owner drafts: `.editorconfig`, `.gitattributes`, `.gitleaks.toml`, `.pre-commit-config.yaml`, `scripts/leakcheck.sh`, `.github/CODEOWNERS` and `.github/pull_request_template.md`.
- Add the CI checks workflow `.github/workflows/ci.yaml` with one aggregate check "CI OK", and `.github/workflows/pr-title.yaml`. Pin each action by commit SHA.
- Reject YAML files with the `.yml` extension in a pre-commit hook and in a CI step.
- Add `LICENSE` (MIT), `SECURITY.md` (threat model skeleton) and a short `README.md`.
- Not in this change: the release workflow, `.releaserc.json`, `apps/desktop`, `apps/android` and all product code.

## Capabilities

### New Capabilities

- `repository-tooling`: the workspace layout, the pinned toolchain, the local check command, the git hooks, the leak check and the CI checks.

### Modified Capabilities

(none)

## Impact

- New root files and 14 new workspace packages. No product behavior changes.
- New dev dependencies: TypeScript, ESLint, typescript-eslint, Prettier, `prettier-plugin-organize-imports`, Vitest, `@types/node`, `globals`.
- Contributors install pre-commit and go-task, and run `pre-commit install` once per clone.
- `AGENTS.md`: the commands that now exist lose the word "planned".
- `docs/tech-stack.md` 2.6: one row for `@eslint/js`, `globals` and `@types/node` (engineering-rules 4.11).
