# Agent Workspace — Engineering rules

| Item | Value |
|---|---|
| Document | Rules for contributors and coding agents |
| Version | 0.8 (2026-11-22. 0.7: library rule and criteria; adaptive layout, keyboard and mouse rules; layout tests. 0.8: pnpm 10.16 and release-age pins, Play services class, exact `configChanges`, `CmdOrCtrl` shortcuts) |
| Readers | Contributors, maintainers, AI coding agents |
| Source of truth | `principles.md`. Apply its design test to each change. Accepted decisions in `decisions/` win over this file. |

Obey these rules for every change. When a rule blocks you, add an entry to the exceptions table (section 12) in the same pull request. `AGENTS.md` at the repository root is the short version for agents.

## 1. Process
1. Start each change with an OpenSpec change: proposal, design, specs, tasks.
2. Update the OpenSpec artifacts before you change the code.
3. End each task list with a verification task that runs the full stack.
4. Commit or push only when a maintainer asks for it.
5. Use one pull request for one change.
6. Build phase 1 inside the final structure (`phase-1.md` 11 and 12). Do not add a shortcut that phase 2 must rewrite.
7. Done means: lint, typecheck and tests pass, the OpenSpec tasks are checked, and the pull request has the evidence.

## 2. Writing
1. Write all text in ASD-STE100: documents, comments, commit messages, UI copy, error messages. Name the specific file, command, value or error text.
2. Use one term for one concept. Use the terms of `docs/prd.md` section 6 and `docs/architecture.md` section 12, for example "main device", "remote device", "owner device", "session host", "sync engine".
3. Say "People". Do not say "teammate".
4. Write an agent as `agent@device`, for example `claude@ubuntu-01`. Write buttons as a verb and an object: "Approve proposal".

## 3. Open-source hygiene
1. Do not commit personal data: names, emails, home paths, tokens, hostnames, IP addresses.
2. Use synthetic examples only: MacBook Pro, ubuntu-01, mac-mini-lab, Pixel 9, `example.com`, the skill namespace `my-team:`. Do not copy data, names or scenarios from private projects.
3. Run `task leakcheck` (`scripts/leakcheck.sh`) before you push. The pre-push stage of pre-commit runs it on the pushed range. CI runs the generic patterns: home paths, emails, token shapes, private keys. Put your private terms in `tmp/leakcheck.local`; only your machine reads them. The script does not find everything: read the full diff of each non-code file before a push.
4. Keep local files in `tmp/`. Git ignores it.
5. Use the license header "The agent-workspace authors".
6. Ship `THIRD_PARTY_NOTICES` with each app. It holds the Syncthing MPL-2.0 text, the authors and a link to the source tag. Do not use the Syncthing name or logo as AW branding.
7. Name an upstream project by its public repository, for example `syncthing/syncthing`, never by a local path. Remove paths, host names and session ids from captured fixtures (transcripts, statusline JSON, hook events).

## 4. Repository and toolchain
1. Pin the toolchain: `.nvmrc` (Node 26, the current LTS), `packageManager` (pnpm 10.16 or later through corepack), the JDK 21 toolchain for Android. Older pnpm ignores `minimumReleaseAge` with no warning (4.12). CI reads both files and installs with `--frozen-lockfile`.
2. Pin the sync engine in one version file: the Syncthing tag, the sha256 of each binary, the Go and NDK versions of the Android build.
3. Use `.yaml` for YAML files, also for workflows. A pre-commit hook and a CI step reject `*.yml`. Keep `.editorconfig` (UTF-8, LF, 2 spaces, width 100; Kotlin 4 spaces, width 120) and `.gitattributes` (`* text=auto eol=lf`, binary types, generated files marked). Install the hooks once per clone with `pre-commit install`. They run the standard set (private keys, files over 1 MB, merge markers, YAML and JSON syntax), gitleaks, Prettier, ESLint, ktlint, and the commit message check.
4. Keep each deliverable in its own top-level folder: `daemon/`, `desktop/`, `android/`, `e2e/`. Keep each shared TypeScript library in `shared/`, each plugin in `plugins/`, and the language-neutral contract (JSON Schemas, OpenAPI file, fixtures, test vectors) in `contracts/`. A folder never imports from another deliverable folder. Share TypeScript code only through `shared/`; Kotlin reads only `contracts/`. The root holds only repo-wide files and no tool config of one language (`decisions/2026-11-23-repo-layout.md`). The TypeScript tool config is in `shared/config`.
5. Keep manifest versions at `0.0.0`. The git tag is the version.
6. Use native addons only with N-API prebuilds. Sign them inside the app. List them in the pnpm build allowlist.
7. CI owns these files. Never edit them by hand: `Casks/*.rb`, the version fields, the generated JSON Schemas and Kotlin classes, the tags.
8. Use a maintained library for each job outside the AW core. Write own code only for the core: the file model and merge, the ownership rules, the HLC, the Syncthing REST client logic, the session launcher and safe delivery, the gate logic.
9. Add a library only when it meets each criterion:
   1. License: MIT, ISC, BSD or Apache-2.0 (ship its NOTICE). No GPL, LGPL, AGPL or commercial license. MPL-2.0 only for an unmodified, separate binary (3.6). Google Play services and Firebase SDKs (Android SDK license) only in the Play build, behind an adapter, with a fallback in other builds: the ML Kit code scanner (fallback: paste) and FCM in `embedded-fcm-distributor` (fallback: ntfy).
   2. Maintained: a release in the last 6 months, and the repository is not archived.
   3. Typed: the types ship in the package or in a maintained `@types` package.
   4. Wide use: 1 million or more npm downloads per week, or an AndroidX, JetBrains, Google or official vendor SDK library.
   5. Small surface: it does the one job that AW needs, with few dependencies.
   6. No native build, unless the job needs one. Then use N-API prebuilds only (4.6).
10. Before you select a library, check the other projects of the maintainers. When one of them already uses a library for the same job and it meets 4.9, use that library.
11. Add each library to `tech-stack.md` section 2 in the same pull request: the version, the use in AW, the reason and the rejected alternative. A library that fails a criterion of 4.9 needs a row in section 12.
12. Keep pnpm `minimumReleaseAge` at 10080 (7 days), so a new release waits 7 days before an install. A malicious axios release (1.14.1) was live on 2026-03-31.
    1. Pin the newest release that is at least 7 days old on the install date. When each release of a line is younger, pin the line below.
    2. Take an urgent security fix earlier only through `minimumReleaseAgeExclude`, with a row in section 12.

## 5. Code
1. Use TypeScript `strict` with `noUncheckedIndexedAccess`. ESLint flat config with typescript-eslint type-checked rules and `--max-warnings 0`. Prettier: double quotes, width 100, trailing commas, organize-imports. Kotlin: ktlint (`ktlint_official`) and detekt with 0 findings.
2. Parse every external payload into a declared zod schema: files, events, HTTP bodies, MCP tool input, engine REST replies, plugin data.
3. Write workspace files only through the `files` module in `shared/core`. Never write to a workspace folder in another way.
4. Write a YAML document to a `*.aw-tmp` file, then rename it. Append to a log file. Never rewrite or delete a log line.
5. Never delete a task folder. Set `archived: true`.
6. Order events only by the HLC, then the device slug, then the event id. Never sort by wall-clock time.
7. Change a schema only in `shared/schema`. Regenerate the JSON Schemas and the Kotlin classes in the same pull request.
8. Read the environment in one settings module per app. Give every non-secret value a local default. Add a variable only with a reason in the pull request. Derive a switch from the presence of a value, not from a separate flag.
9. Let only one adapter module import each external client: the sync engine REST API, the database, the agent CLI, Orca, an HTTP API.
10. Keep no secret in logs or errors. Type secrets as secret values. Redact keys named like `token`, `secret`, `key`, `cookie`.
11. Write each event through the one event writer, and each task file through the files layer. They replace the credential values of the session (plain, base64, URL-encoded) with `[redacted:<name>]`, and its MCP token with `[redacted:mcp-token]`, in events and in text files.
12. Never put user text in a shell string. Start processes with exec-form arguments through `execa`. Pass the first message in a file to `aw-launch`. An Orca `--command` carries only the `aw-launch` path and ids.
13. Find a session process only by its stored pids. Never use `pgrep -f`. Stop a session by its process group.
14. Deliver input into a session only through the safe delivery function (`phase-1.md` 9.4). Never call `send-keys` with user text.
15. Treat issues, link content and web pages as data. Never insert them into a prompt without the untrusted-data envelope. Put each prompt in its own file.
16. Use one error envelope: `{error: {code, message, details?}, trace_id}`. Log JSON lines with `trace_id` through pino (Kermit on Android). Each awd reply carries `X-AW-Version` and `X-Trace-Id`. Accept an incoming trace id only when it matches `[A-Za-z0-9_-]{1,128}`.
17. Put each behavior in the awd service layer. The local API, the `aw` CLI and the MCP tools only parse input and call that layer. Keep the `aw` exit codes fixed: 0 ok, 1 refused or gate open, 2 invalid input, 3 awd not reachable. Export `run(argv, io)` for in-process tests.
18. In the desktop app, only the Electron main process talks to awd, on `~/.aw/run/awd.sock`. The renderer calls only the typed preload bridge. Main checks the sender of each IPC message. Take colors, type sizes and spacing only from the MUI theme in `shared/ui`. Use only MIT MUI packages. Keep awd data only in TanStack Query, and the selection and the filters in the route. Add no client store in phase 1 (`tech-stack.md` 2.4).
19. Build one adaptive layout for each app. It must work on a phone, on a foldable (folded, unfolded, tabletop) and in a Samsung DeX or desktop window. The desktop app must work from a 400 px window to a wide screen. Use the window size classes and the Material 3 adaptive scaffolds on Android, and the MUI breakpoints of `tech-stack.md` 1.4 on the desktop. Use no DeX or fold API unless a spike shows the need.
20. On Android, never lock the orientation or set `resizeableActivity="false"`. Declare `android.hardware.touchscreen` with `required="false"`. Set `android:configChanges="orientation|screenSize|smallestScreenSize|screenLayout|density|uiMode|keyboard|keyboardHidden|navigation"`, so a fold, a resize or a keyboard or mouse attach does not recreate the activity. Keep state in ViewModels and `rememberSaveable`.
21. Support a keyboard and a mouse on each screen of both apps: a visible focus, Tab and arrow order, Enter to send, Esc to close. Search, New task and Sync now are Ctrl+F, Ctrl+N and Ctrl+R on Android, and `CmdOrCtrl+F`, `CmdOrCtrl+N` and `CmdOrCtrl+R` in the desktop app. The production app menu removes the `reload` and `forceReload` roles, so "Sync now" owns `CmdOrCtrl+R`. A right-click opens the same menu as a long press. Each clickable item shows a hover state. List the Android shortcuts in `onProvideKeyboardShortcuts`.

## 6. Security
1. Keep device keys in the OS keystore, or in a 0600 file on a headless Linux device.
2. Never read, store or forward agent credentials. Run the user's installed binary. Read only `claude auth status --json`, the statusline JSON and hook events.
3. Never put a token in a command line, a terminal title, a tmux window name or a shell history. The fixed launcher `aw-launch` reads secrets from 0600 files.
4. Never put a secret in a synced file in clear text. Encrypt credential files with the workspace credential key (`decisions/2026-11-22-task-model.md` §4). Keep them in the `secure` folder, which is never shared with the phone.
5. Write `config.xml` before the first engine start (`phase-1.md` 6.1). Keep NAT traversal, usage reports and crash reports off, and `maxConflicts` at 10 or more. Keep the REST API on loopback or a Unix socket, with a random API key.
6. Never send plain user content to a relay, a push service or a storage.
7. Give a plugin only the permissions in its manifest.
8. Keep the awd socket at mode 0600 in a 0700 folder. Bind the MCP server to `127.0.0.1` only. Check Host and Origin. Accept only a token bound to one session and one task, compared in constant time.
9. Pin third-party GitHub Actions by commit SHA with a `# vX.Y.Z` comment. Set `permissions: contents: read` at the top and add more only per job. Run gitleaks on the full history and `pnpm audit --prod --audit-level high` in CI. Both block a merge. Put each accepted finding in section 12.
10. CI passes secrets through stdin or 0600 files in `$RUNNER_TEMP`, never as arguments. Signing secrets (Apple, Android upload key, Ed25519 release key) exist only in the GitHub environment `release`, which only `main` can use. Pull request builds get no credentials.
11. Use `wss://` with pinned certificates for the live channel. Never ship cleartext `ws://`.

## 7. Tests
### 7.1 General
1. Write a test that fails before the fix. Show that it can fail.
2. Put unit tests next to the code (`*.test.ts`). CI runs them on ubuntu and macOS, on Node 26 (the current LTS only). CI also runs `npm pack --dry-run` on the awd package, and a test keeps each plugin `SKILL.md` below 6,000 characters.
3. Use the fake agent runtime and fake platforms in tests. Never call a paid API in CI.
4. Copy fixtures from real responses. Write the source and the date of the capture next to the fixture.
5. Read the time only through the clock module. Use the fake clock in tests. Never sleep in a test to wait for a timer.
6. Keep contract tests for each supported version of Claude Code, Orca, tmux and the sync engine. Record their help output, hook schemas and REST replies as fixtures. For Claude Code, also test the worktree trust entry that `aw-launch` writes: check that only that entry changes in the user's Claude Code state file and that the backup restores it. Read the `name` in the plugin `plugin.json` and check that the `aw-launch` allow rule `mcp__plugin_<name>_aw__*` matches it.
7. A test that needs a local app (a real `claude`, `AW_E2E_ORCA=1`) is opt-in and prints "skipped: <tool> not installed". List each one in `e2e/README.md`. The real-device check (7.5.15) runs them.
8. Test each layout at fixed widths. Compose UI tests use `DeviceConfigurationOverride.ForcedSize` at 360, 600, 840 and 1280 dp, and a `FoldingFeature` from `window-testing` for the hinge and tabletop. Playwright opens the desktop window at 400, 840, 1280 and 1600 px. The nightly Android job also runs the Pixel Fold emulator and a tablet emulator with desktop windowing, a mouse and a keyboard.

### 7.2 Phase 1 test environment
`e2e/compose.yaml` runs:
1. 2 computers: `macbook-pro` and `ubuntu-01`. Each has awd, the pinned Syncthing binary, tmux and the fake agent.
2. A Docker network that the tests can cut per device. A cut simulates a sleeping laptop or a lost network.
3. ntfy for push tests, and the fake clock. The community servers are off. The devices use their Docker addresses.

The Kotlin core runs the same fixture tests on the JVM. A nightly job runs the Android app with its engine on an emulator against the compose stack. The e2e job uploads `e2e/out/` (terminal captures, awd and engine logs) and prints the compose logs on failure.

### 7.3 Schema tests
1. Each fixture document and each fixture log line validates against its JSON Schema.
2. CI runs `pnpm schema:generate`, then `git status --porcelain -- contracts/schemas contracts/samples android/shared/generated` must be empty (this also finds a new file that is not in git). It does the same check for the engine version file and `THIRD_PARTY_NOTICES`.
3. awd reads files of the current and the previous major version.
4. A file of a newer major version shows "Update AW on <device> to read N new files" and stops nothing.
5. A file that fails its schema keeps the last valid version in the index and creates the Inbox item.

### 7.4 Sync and conflict tests
1. Both computers write their own files at the same time (400 writes each). Check 0 conflict copies and equal trees.
2. **First-start leak check.** Start a new engine with the AW template. Check that the log has no discovery, relay, UPnP, NAT-PMP or usage-report line, and that only the listen port and the local REST port are open.
3. **Conflict resolver.** Both change the same shared file while the network is cut, once with each side newer. Check that the copy name has the short id of the winner, that the journal finds the author, that the priority rule wins, that no copy is left, and that the other version is in the history store.
4. Set `maxConflicts` to 0 in a test config. Check that awd refuses the config.
5. **Versioning and Undo.** Another device changes and deletes a knowledge file; the local device edits one. Check a version for each change and that Undo restores it on both devices.
6. A conflict copy of a device-owned log. Check that the owner merges the lines by event id.
7. A delete against a modify of a task folder. Check that the index accepts the orphan log file.
8. Both create a task while the network is cut. Check the task key collision rule, `task.rekeyed` and one folder per task id.
9. Move a task while the old owner is cut off. Check that its later state events do not count and that its comments merge.
10. A peer is offline. Check that "Sync now" scans first and reports "N changes not synced to <device> (offline)", never "Synced".
11. Freeze both engine processes of a device (SIGSTOP). Check that the others mark it offline from the missing heartbeats within 90 s.
12. A hot log file. Check the once-per-second write, the targeted scan, and that the other device sees it within 8 s.
13. Kill the engine during a sync of 2,000 files. Check that awd starts it again and that the trees become equal.
14. Check that the phone engine has no `secure` folder and never receives a credential file.
15. TypeScript and Kotlin merge the same fixture folders to the same index result.

### 7.5 Session and continuity tests
Run each test on `host-tmux` with awd and the fake agent. Run the same tests on `host-orca` where they apply: in CI against a fake `orca` CLI made from the recorded fixtures (7.1.6), and locally with `AW_E2E_ORCA=1` against the real Orca. The harness drives real binaries in a detached tmux on a private socket and waits for the screen text before it sends input. It never uses a tmux shim of another tool (it skips `/.orca/` paths); `AW_E2E_TMUX` selects the binary.
1. Kill awd with `kill -9` during a session. Check that the session continues, that no hook event is lost and that no resume runs.
2. Simulate a reboot: kill tmux and awd with SIGKILL, then start awd. Check the `--resume` call, the stored launch flags and the thread message.
3. **Resume message order.** Check that the continue message is the last argument after `--`, and that it is the first UserPromptSubmit after the SessionStart `resume`.
4. **Process-group kill.** The agent starts a background command. Force a stop. Check that no process of the session group or its descendants is left.
5. A first message with quotes, a backtick, `$(touch x)` and 3 lines. Check that no command runs and that the agent gets the text as is.
6. A session prints its credential and `AW_MCP_TOKEN`. Check that each log line shows `[redacted:<name>]` and `[redacted:mcp-token]`.
7. **Thread.** Text typed into the pane and each agent reply appear in `aw thread` on another device, word for word.
8. **Delivery.** Deliver an answer while a permission dialog is open, a multi-line answer, and an answer during a busy turn. Check one input each, with a confirmed delivery id.
9. `AskUserQuestion`, `ExitPlanMode` and a turn that ends with a question. Check that each opens a gate.
10. **Claims.** 2 devices claim the same task, and a laptop wakes with a moved task. Check one running session, and the branch `aw/<key>-<device>-<time>` with the unpushed work.
11. Two permission requests in a row. Check that each answer applies only to its own request id, that a deny reaches the agent as input, and that a late "Allow" after 120 s works once.
12. Fake a usage limit: StopFailure `rate_limit` and a statusline with `used_percentage: 100` and `resets_at`. Move the fake clock. Check the pause text, no push, and the continue at the reset. Cover a reset more than 24 h away and the cap of 3 continues.
13. Update awd during a session. Check that the session continues and that a version that fails 3 starts rolls back.
14. **MCP.** Call each MCP tool and the same `aw` command. Check equal results, a refused token of another session, and the tools after an awd restart.
15. Before each release, run the real-device check: a real Mac and Linux remote device (real reboot), the Android emulator in Doze, a real Claude Code session on MCP, Orca on both, and the signed app's notifications. Also a real Galaxy foldable (folded, unfolded, tabletop) and Samsung DeX on a monitor with a mouse and a keyboard. No emulator runs DeX.

The fake agent behaves like `claude`: launch flags, `--resume`, hooks, the statusline JSON, transcripts, the trust screen and the "Resume this conversation?" dialog. Phase 2 adds tests for peer links, the own iroh relay and R2.

## 8. Local environment
1. Planned: `task dev` starts awd with the engine, tmux and the fake agent, and the desktop app. It needs no `.env` file. Until then, use the `awd` commands of `AGENTS.md`.
2. Planned: `task dev:remote` adds a second awd with its engine in Docker as `ubuntu-01`, paired and in a full mesh.
3. Planned: `task dev:phone` starts the Android app on an emulator and pairs it.
4. `AW_CLAUDE` selects the agent binary. Tests set it to the fake agent (`plugins/agent-claude/testing/bin/claude`). An awd with no `AW_CLAUDE` runs your own `claude` with your own login, and it uses the paid model. `AW_CLAUDE_MODEL` selects the model, for example `haiku`. Never run a real `claude` in CI. `e2e/README.md` gives the opt-in runs. `task e2e` runs the e2e suite in Docker.
5. Each external platform has a fake server with fault injection: delay, error, rate limit, malformed data.

## 9. Pull requests
1. Use a Conventional Commits title: `type(scope)!: subject`, a lower-case scope, at most 100 characters. Types: `feat`, `fix`, `perf`, `revert`, `refactor`, `docs`, `test`, `chore`, `ci`, `build`. The commit-msg hook checks local commits with the same rule. Select the type with care: it sets the release (10.1).
2. Work on a branch `<type>/<short-kebab-description>`. Squash-merge only. One approval. Never push to `main`.
3. Put the evidence in the pull request: commands, results, screenshots or videos for UI changes.
4. The ruleset of `main` requires the checks "CI OK" and "PR title" and a review from the code owners. CODEOWNERS covers `contracts/`, `shared/schema`, `shared/core`, `shared/config`, the security code, the engine version file, `scripts/`, `.github/workflows/` and `CODEOWNERS` itself.

## 10. Release
1. semantic-release reads the commit subjects on `main`. `feat` makes a minor release; `fix`, `perf` and `revert` make a patch; `!` or `BREAKING CHANGE` makes a major. Other types make no release, because each release notarizes the Mac app, uploads the Android bundle and updates every device. Do not create tags by hand, except the seed tag `v0.0.0`.
2. The notes are only on the GitHub release. There is no changelog file, and semantic-release writes no comments. Keep the exact semantic-release package versions in one variable and change them together. Before a change, run a full dry-run against a local copy of the repository.
3. The release runs only after "CI OK" passes on `main`. Its concurrency group never cancels. CI cancels old runs only for pull requests.
4. Order: compute the version with `semantic-release --dry-run`; build each artifact once with that version (`AW_VERSION`, no change to `package.json`); publish with semantic-release; check that it published the same version.
5. The artifacts: the npm package of awd and `aw` (JS from `tsc`, `pnpm --filter @aw/daemon build`; `aw engine install` downloads the pinned engine and checks its sha256, so the package holds no engine binary), the signed and notarized macOS app with the nested engine, the Homebrew cask, the Android app bundle and APK, the JSON Schemas, and `checksums.txt` signed with Ed25519. awd tarballs have stable names without the version.
6. CI checks the sha256 and the PGP signature of each engine binary before it packs it. After signing, it runs `codesign --verify --deep --strict` on the app and the engine, and `spctl --assess` after notarization.
7. CI updates the Homebrew cask in `Casks/` through a pull request that it merges.
8. npm uses trusted publishing (OIDC) and no token. It publishes after the GitHub release. The trusted publisher names the workflow file: update it on npmjs.com before you rename the file.

## 11. Compatibility
1. Version each document type and each event type. awd and the phone read the current and the previous major schema version.
2. Detect the version and the capabilities of each agent runtime, session host and sync engine. Gate features on them.

## 12. Exceptions
| Rule | Reason | Owner | Until |
|---|---|---|---|
| 4.9.2 | `react-markdown` 10.1 and `remark-gfm` 4.0: last releases 2025-03 and 2025-02. The repository is active (2026-10), and the API is stable. | Desktop app maintainers | Review on 2027-05-22 |
| 4.9.2 | `@xterm/xterm` 6.0: last stable release 2025-12. The 6.1 betas publish each day. | Desktop app maintainers | The next stable release; then pin it |
| 4.9.2 | `diff` 9.0: last release 2026-04 (7 months). Mature, with a small API. | Desktop app and awd maintainers | Review on 2027-05-22 |
| 4.9.4 | `qr` 0.7: small user base. No dependencies, same author as `@noble`. The common `qrcode` fails 4.9.2 (last release 2024-08). | Desktop app maintainers | Review on 2027-05-22 |
| 4.9.4 | `@dnd-kit/react` 0.5: a 0.x line, so pin it exactly. The older `@dnd-kit/core` has had no release since 2024-12. | Desktop app maintainers | Version 1.0 |
| 4.9.4 | `kotaml` 0.113: a maintained fork of the archived `kaml`, with a small user base. Fallback: `snakeyaml-engine-kmp` 5.0 into `JsonElement`. | Android app maintainers | Review on 2027-05-22 |
| 4.9.2 | ktlint 1.8.0 (2025-11): the newest release. `engineering-rules.md` 5.1 names ktlint; Spotless 8.9 (2026-07) runs it. | Android app maintainers | The next ktlint release; review on 2027-05-22 |
| 4.9.2 | detekt 2.0.0-alpha.6 (2026-08), a pre-release line, pinned exactly. The stable 1.23.8 (2025-02) fails 4.9.2 and cannot analyse Kotlin 2.4 code. | Android app maintainers | detekt 2.0.0; then pin it |
| 4.9.2 | `kotlinx-coroutines` 1.11.0 (2026-05-07): the newest release, 6.5 months old on 2026-11-23. JetBrains maintains it, and Room 3 needs it. | Android app maintainers | The next release; review on 2027-05-22 |
| 4.9.4 | `multiplatform-markdown-renderer-m3` 0.46.0 (Apache-2.0): not AndroidX, JetBrains or Google, and no npm count. Maintained since 2021 with a release each month; it uses the JetBrains Markdown parser. It draws Compose text only (no HTML, no WebView, no remote image). | Android app maintainers | Review on 2027-05-22 |
| 4.9.4 | Kermit 2.2 (Touchlab, Apache-2.0): a KMP logger, not from AndroidX, JetBrains or Google. Small surface, active repository. | Android app maintainers | Review on 2027-05-22 |
| 4.9.4 | UnifiedPush `connector` 3.3 and `embedded-fcm-distributor` 3.1 (Apache-2.0): a small user base. No other path gives Web Push without an AW push gateway (D12). Spike S1. | Android app maintainers | Review on 2027-05-22 |
| 4.9.4 | `age-encryption` 0.3 (BSD-3-Clause): about 740,000 npm downloads per week (2026-11-22). The author of the age format maintains it (`FiloSottile/typage`), and the format is fixed (task-model §4). | awd maintainers | Review on 2027-05-22 |
| 4.9.2 | ML Kit code scanner (`play-services-code-scanner`) 16.1.0: last release 2023-08. A Google Play services SDK with a stable API; the only scanner that needs no camera permission. Play build only, with the paste field as the fallback (4.9.1). | Android app maintainers | Review on 2027-05-22 |
| 6.1 | awd keeps the device key in a 0600 file also on a Linux desktop and with `AW_HOME` set, unless `AW_KEYSTORE=os`. A Linux desktop can have no unlocked Secret Service when awd starts as a user service, and tests and a second awd must never write into the keystore of the person (openspec add-identity-and-pairing, design decision 4). | awd maintainers | A check of the session bus at the start; review on 2027-05-22 |
| 5.8, 5.12 | `daemon/src/bin/aw-statusline.ts` reads `process.env.AW_USER_STATUSLINE` outside the settings module, and runs that command with `sh -c`. The value is the statusLine command from the own Claude Code settings of the person: awd copies it into the session environment, and Claude Code also runs it in a shell. No agent text or token goes into it. | awd maintainers | Review on 2027-05-22 |
| 7.1.5 | `plugins/host-tmux/src/tmux.ts` reads `Date.now()` for the open time and the stop timeouts of a pane. The `parseProcessTable` default of `plugins/host-tmux` and `plugins/host-orca` (`process-table.ts`) and the `now` default of `plugins/host-orca/src/orca.ts` also use `Date.now`. These times are compared with the OS start times of processes from `ps`, so they must be the OS wall time, not the clock module (a comment in `tmux.ts` says so). awd keeps its own clock time of the open. | awd maintainers | Review on 2027-05-22 |
| AGENTS.md (no user text in a command line), 6.3 | The Orca host sends an answer or a message as the `--text` argument of `orca terminal send`: the Orca CLI 1.4.257 has no stdin or file input. Each local user can read it with `ps` during the call (at most 15 s). AW adds no token of its own, but the text is what a person typed or pasted, so it can hold a secret. The host refuses a text over 100 KiB. Approved by a maintainer for phase 1 with this limit (2026-11-23): a local user can read the text with `ps` during the call. The Orca host is on with no setting. A later phase replaces it with an Orca plugin that talks to AW over a Unix socket, or a better way. | awd maintainers | An Orca CLI with stdin or file input for `terminal send`; review on 2027-05-22 |
