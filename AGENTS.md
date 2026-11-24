# AGENTS.md

Rules for coding agents in this repository. `CLAUDE.md` imports this file. Keep it below 100 lines and put details in `docs/`.

## What AW is
Agent Workspace (AW) lets a person manage the work of AI coding agents from the desktop app or the phone. The agents run on the person's own computers, keep working while the laptop is closed, and the devices sync their files directly.

## Read first
1. `docs/principles.md`. Read it first and obey it. When a decision, a rule or a request does not agree with a principle, the principle wins. Apply its design test to each change.
2. `docs/decisions/*.md`: accepted decisions. They win over older text in other documents.
3. `docs/engineering-rules.md`: the full rules for code, tests, security, pull requests and releases. This file is a summary.
4. `docs/workflow.md`: the task loop, the gates, delivery, the `aw` commands.
5. `docs/phase-1.md`: the phase 1 scope, the file layout (3.1), the repository layout (11), the stable interfaces (12).
6. `docs/architecture.md`, `docs/tech-stack.md`, `docs/prd.md` (terms in section 6).
7. `README.md` "Status": the parts that exist. Items marked **planned** do not exist yet. When a task adds one, check it against `package.json` and `Taskfile.yaml`, then remove "planned".

## Commands
```sh
corepack enable && pnpm install  # once per clone: pnpm from packageManager, then the dependencies
pre-commit install               # once per clone: hooks for pre-commit, commit-msg, pre-push
task check                       # YAML extension, then the check of each folder (scripts, shared, daemon, desktop,
                                 # plugins, e2e: format, lint, typecheck, tests; android: task android:check), then the leak check
cd daemon && task check          # the checks of one folder
pnpm test                        # unit tests (Vitest) of each package, one package at a time
cd daemon && pnpm exec vitest run <file> -t "<name>"   # one test
pnpm format:check && pnpm lint && pnpm typecheck
task leakcheck                   # generic patterns + your tmp/leakcheck.local (or AW_LEAKCHECK_TERMS)
task dev | dev:remote | dev:phone   # planned: awd + engine + tmux + fake agent + desktop app (no .env file) | a second awd in Docker as ubuntu-01 | the Android app on an emulator, paired
pnpm schema:generate             # contracts/schemas/, contracts/samples/ and the Kotlin classes (android/shared/generated/) from shared/schema
pnpm api:generate                # contracts/openapi.yaml (OpenAPI 3.1) from the local API routes
pnpm --filter @aw/daemon build   # npm package folder daemon/dist/npm/ (JS only); the app: pnpm --filter @aw/desktop package
AW_HOME=/tmp/aw node daemon/src/bin/awd.ts   # awd in a terminal, with its own state folder
AW_HOME=/tmp/aw node daemon/src/bin/aw.ts status   # the aw CLI
AW_HOME=/tmp/aw AW_CLAUDE=$PWD/plugins/agent-claude/testing/bin/claude node daemon/src/bin/awd.ts   # sessions with the fake agent
task e2e                         # e2e suite in Docker (e2e/compose.yaml): 2 devices with awd and the sync engine
pnpm --filter @aw/sync-syncthing engine:fetch   # the pinned sync engine into the test cache (sha256 checked)
pnpm --filter @aw/identity vectors              # contracts/test-vectors/identity.json (the Kotlin age files come from AgeVectorsTest of android/identity)
task android:check               # android/: ktlint (Spotless), detekt, :shared, :identity, :engine and :control jvmTest; needs a JDK 21 (part of task check)
task android:engine-libs         # android/: build libawsync.so with the pinned Go and NDK (needs the NDK)
task android:app                 # android/: build the debug APK (needs the Android SDK)
```

## Layout
One folder per deliverable. The root holds only repo-wide files and no tool config of one language (`docs/decisions/2026-11-23-repo-layout.md`).
- `contracts/`: the language-neutral contract: `schemas/` (generated JSON Schemas), `samples/` (generated schema samples), `openapi.yaml`, `fixtures/`, `test-vectors/`. TypeScript and Kotlin tests read it. It is not a package.
- `daemon/`: awd, the `aw` CLI, the MCP server, the service units, `bin/aw-launch`.
- `desktop/`: Electron + React + MUI. Only the main process talks to awd, on `~/.aw/run/awd.sock`. The renderer uses only the preload bridge. Run it with `pnpm --filter @aw/desktop dev` (once before: `pnpm --filter @aw/desktop electron:fetch`).
- `android/`: Gradle Kotlin Multiplatform and Compose Material 3. `shared/` has the file model, the merge and the Room index, and the generated classes in `shared/generated/kotlin/`. It reads only `contracts/` (the JVM tests read `contracts/fixtures`, `contracts/test-vectors` and `contracts/samples`). `identity/` has the identity formats and the age sealer (Tink), with the shared vectors `contracts/test-vectors/identity.json`. `engine/` has the pins of `libawsync.so` (`engine-version.properties`), its build script and the Kotlin engine controller (`SyncEngineController`, JVM tests). `control/` has the logic of the screens with JVM tests (no Android SDK). `app/` has the Compose screens, the foreground service that runs the engine and the push receiver.
- `shared/`: TypeScript libraries: `schema/` (zod, the source of all file formats), `core/` (files, merge, index), `identity/` (keys, records, pairing codes, sealing, keystore), `plugin-api/`, `client/`, `ui/` (MUI theme tokens), `config/` (tsconfig base, ESLint preset, Prettier config).
- `plugins/`: `agent-claude`, `host-tmux` (default), `host-orca` (optional), `kb-files`, `sync-syncthing`, `push-webpush`, `live-direct` (placeholder). A plugin never imports another plugin.
- `e2e/`: the end-to-end suite. `scripts/`: the repo-wide checks (package `@aw/scripts`).
- A folder never imports from another deliverable folder. Shared TypeScript code goes through `shared/`.
- Each TypeScript package has its own tools and config files: `tsconfig.json` extends `@aw/config/tsconfig.base.json`, `eslint.config.js` uses `@aw/config/eslint`, the `prettier` key names `@aw/config/prettier`, and the tool versions come from the pnpm `catalog:`.

## Conventions that one file does not show
- The `aw` CLI, the MCP tools and the local API call the same awd service code. Do not put logic in a transport.
- Each app reads the environment in one settings module. Nothing else reads `process.env`.
- One adapter module per external client: engine REST, database, agent CLI, Orca, HTTP API.
- Write workspace files only through `shared/core` `files`. Order events by the HLC, never by wall-clock time.
- Start processes with exec-form arguments. Never put user text or a token in a shell string or a command line.
- Read the time only through the clock module. Tests use the fake clock.
- Use a maintained library for each job outside the AW core (`docs/engineering-rules.md` 4.8 to 4.12, `docs/tech-stack.md` 2). Check the maintainers' other projects first. Write own code only for the core.
- One adaptive layout per app. Android: window size classes, Material 3 adaptive scaffolds, no orientation lock, keyboard and mouse support. Desktop: 400 px to a wide screen (`docs/engineering-rules.md` 5.19 to 5.21).

## Pull requests and releases (IMPORTANT)
- Commit or push only when a maintainer asks for it. Never push to `main`. Use a branch `<type>/<short-kebab-description>`.
- Start each change with an OpenSpec change in `openspec/changes/<name>/`. Update it before the code.
- PR title: Conventional Commits, `type(scope)!: subject`, at most 100 characters. Merges are squash-only, so the title sets the version:
  - `feat`: minor. `fix`, `perf`, `revert`: patch. `!` or `BREAKING CHANGE`: major.
  - `refactor`, `docs`, `test`, `chore`, `ci`, `build`: no release.
- A release ships the signed Mac app, the Android app, the npm package and the cask, and updates every device. Select the type with care.
- CI owns these files. Never edit them by hand: `Casks/*.rb`, the `version` fields (`0.0.0`), the generated schemas and Kotlin classes, the tags.

## Tests
- A new test must be able to fail. Break the code once, see the test fail, restore the code.
- Fixtures copy real responses. Write the source and the capture date next to each fixture. Remove paths, host names and session ids.
- E2E tests drive real binaries. Wait for the screen text before you send input.
- In some agent sessions, `tmux` in `PATH` is a shim of another tool (for example in `/.orca/`). The harness skips such paths. Set `AW_E2E_TMUX` to select a binary.
- Never call a paid API in CI. awd without `AW_CLAUDE` runs the real, paid `claude`. Tests set `AW_CLAUDE` to the fake agent. Real Claude Code and real Orca runs are opt-in (`AW_CLAUDE_MODEL`, `AW_E2E_ORCA=1`): see `e2e/README.md`.

## Writing (ASD-STE100)
Use it for all text: docs, comments, commit messages, PRs, OpenSpec, UI copy, errors.
1. Write one topic in one sentence.
2. Write instructions with 20 words or fewer, and descriptions with 25 words or fewer.
3. Use the active voice. Write instructions as commands.
4. Use one term for one concept. Use the terms of `docs/prd.md` section 6 and the names from the code. Say "People".
5. Do not use idioms, slang or metaphors.
6. Name the specific item: the file, the command, the value, the error text.
7. Write a sequence as a numbered list, with one action in one step.

## Privacy (this is an open-source repository)
- Never commit personal data: names, emails, home paths, host names, IP addresses, tokens, keys.
- Use synthetic examples only: MacBook Pro, ubuntu-01, mac-mini-lab, Pixel 9, `example.com`, `claude@ubuntu-01`, the skill namespace `my-team:`.
- Never name private repositories, companies, customers or their products. Never copy their code, data or scenarios. Copy only generic engineering practice.
- Keep local files (evidence, spikes, screenshots, private notes) in `tmp/`. Git ignores it.
- Run `task leakcheck` before a push, and read the full diff of each non-code file yourself.

## Done means
Lint, typecheck and tests pass. The OpenSpec tasks are checked. The PR has the evidence: commands, results, and screenshots or a video for UI changes.
