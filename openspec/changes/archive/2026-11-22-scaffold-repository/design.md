## Context

The repository has the phase 1 documents and an empty OpenSpec folder. `docs/phase-1.md` section 11 gives the final layout. `docs/engineering-rules.md` sections 4, 5.1, 6.9 and 9 and `docs/tech-stack.md` 1.7 and 2.6 give the toolchain and the checks. The owner gave drafts of the repository rule files. The drafts also contain the release workflow, which a later task adds.

The repository has no remote yet. So CI cannot run on GitHub in this change. Local commands give the evidence.

## Goals / Non-Goals

**Goals:**

- Each later task adds code into the final layout and gets lint, typecheck and tests with no setup work.
- One local command, `task check`, runs the same checks as CI.
- The git hooks and CI reject the `.yml` extension, personal data and secrets.

**Non-Goals:**

- Product code, schemas, the awd service, sync and sessions.
- The release workflow, `.releaserc.json`, publishing and signing.
- `apps/desktop` and `apps/android`. Their tasks create them with their own toolchains.
- A build step. The daemon task adds `tsc` builds and the `pnpm build` script.

## Decisions

1. **Pin the newest release that is at least 7 days old on 2026-11-22** (engineering-rules 4.12.1). The cut-off date is 2026-11-15.
   - pnpm 12.21.0 through corepack. The docs require 10.16 or later. Corepack 0.36 on Node 24.22.3 installs it, and it obeys `minimumReleaseAge` (tested).
   - TypeScript 6.0.3, not 7.0. typescript-eslint 8.72.2 accepts `typescript >=4.8.4 <6.1.0`.
   - typescript-eslint 8.72.2 and Vitest 5.1.0. The 8.73.0 and 5.1.1 releases are younger than 7 days.
   - ESLint 10.15.0, `@eslint/js` 10.0.1, Prettier 3.10.1, `prettier-plugin-organize-imports` 4.3.0, `@types/node` 24.19.2 (the runtime major), `globals` 17.14.0.
   - pre-commit hooks: `pre-commit-hooks` v6.0.0, gitleaks v8.30.1, `conventional-pre-commit` v4.5.0. The drafts had gitleaks v8.28.0 and `conventional-pre-commit` v4.4.0; the newer releases are older than 7 days.
   - Actions by commit SHA: `actions/checkout` v7.0.1, `actions/setup-node` v7.1.0, `pnpm/action-setup` v6.1.1.
2. **One workspace package per layout folder.** Each package is `@aw/<folder>`, version `0.0.0`, `private: true`, `type: module`. It has `tsconfig.json`, `src/index.ts` and `src/index.test.ts`. The e2e package is `@aw/e2e`. Alternative: empty folders with `.gitkeep`. Rejected, because typecheck and tests then do not cover the folders.
3. **Typecheck runs `tsc --noEmit` in each package** through `pnpm -r typecheck`, plus the root `tsconfig.json` for the root config files. Alternative: `tsc -b` with project references. Rejected for now, because the packages do not import each other yet. The daemon task can add references with its build.
4. **ESLint flat config** in `eslint.config.js` with `recommendedTypeChecked` and `projectService: true`. Each file belongs to one `tsconfig.json`, so no default project is necessary. ESLint does not read `.gitignore`, and Prettier does not read `.git/info/exclude`. Thus `globalIgnores` and `.prettierignore` list `.claude/`: the worktrees of other branches and the local agent files are in no `tsconfig.json`, and `pnpm lint` failed on them in the main folder.
5. **Vitest projects** in the root `vitest.config.ts`: one project for each workspace folder, and one `repo` project for `scripts/*.test.ts`. The `repo` project checks the rules of each workspace manifest. Vitest 5 has no separate workspace file.
6. **Prettier does not format Markdown.** `.prettierignore` lists `*.md`. Prettier pads each Markdown table, and it would rewrite all 18 existing documents. The documents follow ASD-STE100, and people review them by hand.
7. **`scripts/check-yaml-ext.sh`** lists the tracked and the untracked `*.yml` files and fails when it finds one. CI and `task check` call it. The pre-commit hook `no-yml-extension` rejects a staged `*.yml` file.
8. **The leak check reads an optional private terms file.** The default path is `tmp/leakcheck.local`, which git ignores. `AW_LEAKCHECK_TERMS` can give another path outside the repository. The script reads the file only when it exists.
   - The verification found 4 faults in the draft script. The fix copies each file to a temporary file, and each check reads that file.
     1. `printf | grep -Iq .` with `pipefail`: on a file larger than 64 KB, the broken pipe made the script skip the file. A token at the end of a 230 KB file passed in 20 of 20 runs.
     2. A placeholder path on a line (`/Users/you`) hid a real home path on the same line. The fix checks each match.
     3. The Windows pattern found only `C:\\Users\\name` with two backslashes. The fix finds one or two.
     4. Command substitution removed NUL bytes, so a binary file was scanned as text.
   - The code review found more faults. The fix:
     1. Git quoted each file name with a non-ASCII character, a double quote or a backslash (`core.quotePath`). `cat` failed, the copy was empty, and the script skipped the file. The script now lists the files with `-c core.quotePath=false` and `-z`, and reads them with `read -d ''`.
     2. A file that the script cannot read is now a failure ("cannot read the file"), not an empty copy. A tracked file deleted from the working tree and a submodule have no content, and the script skips them.
     3. `grep -I` in a UTF-8 locale called a Latin-1 text file binary with GNU grep and with BSD grep. The script now runs with `LC_ALL=C`, uses `grep -a`, and only a NUL byte marks a binary file. The private terms thus match without case only for ASCII letters.
     4. The script scans itself. Its patterns do not match their own text.
   - `scripts/leakcheck.test.ts` runs the script in a temporary git repository. It builds each leak string at run time, so the repository holds no leak string. It uses `node:child_process`, because the test needs no `execa` features.
9. **CI checks only.** Jobs: `rules` (YAML extension, leak check), `node` (ubuntu and macOS, Node 24 and 26: install, format check, lint, typecheck, test), `audit` (`pnpm audit --prod --audit-level high`), `secrets` (gitleaks container on the full history) and `ci-ok` ("CI OK"). The path filter, the Android, desktop and e2e jobs, the schema check and the release job wait for their tasks.
10. **`pnpm/action-setup` installs pnpm in CI.** Node 25 and later do not ship corepack, so CI cannot use corepack on Node 26.

## Risks / Trade-offs

- [pnpm 12 is two majors above the documented 10.16 minimum] → It meets the rule "10.16 or later". The lockfile records the version. A later task can pin a lower line if a problem shows.
- [GitHub CI does not run before the repository exists] → Run actionlint on the workflows. The task repo-seed runs the first real CI.
- [Placeholder tests check only the package name] → They prove that the test runner covers each package. Later tasks replace them.
- [`pre-commit` hooks use `pnpm exec`] → Each contributor runs `corepack enable` and `pnpm install` before the first commit. `README.md` says it.

## Migration Plan

No migration. A new clone runs `corepack enable`, `pnpm install` and `pre-commit install`.

## Open Questions

(none)
