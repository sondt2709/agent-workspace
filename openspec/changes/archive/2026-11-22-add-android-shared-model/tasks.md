## 1. Schemas and the Kotlin generator

- [x] 1.1 Add `.meta({"x-aw-check": ...})` to `hlcText` and `relativePath` in `shared/schema/src/common.ts`
- [x] 1.2 Write `shared/schema/scripts/kotlin.ts` (JSON Schema to Kotlin data classes, checks, event registry) and add `kotlinTarget` to `targets` in `render.ts`
- [x] 1.3 Run `pnpm schema:generate`; update `render.test.ts` for the Kotlin files; check the drift test fails on a schema change

## 2. Gradle project

- [x] 2.1 Create `android` with the wrapper 9.9.1, `settings.gradle.kts`, `gradle/libs.versions.toml`, root `build.gradle.kts`, `.gitignore` entries
- [x] 2.2 Create `shared/build.gradle.kts`: KMP (`jvm()`, Android library), `jvmCommonMain`, the generated source folder, kotlinx.serialization, kotaml, coroutines, Room 3 and KSP, the `aw.schema.dir` system property for tests
- [x] 2.3 Add Spotless (ktlint 1.8.0) and detekt 2.0 with 0 findings, skipping the generated folder

## 3. File model

- [x] 3.1 `Hlc.kt` (format, parse, compare, clock) and the HLC vector test
- [x] 3.2 `JsonSyntax.kt` (V8 message texts) and its tests
- [x] 3.3 `Paths.kt` (the classifyPath rules of the merge sources), `LogReader.kt` (envelope, schema, device, scope, unknown types), `DocumentReader.kt` (YAML, defaults, unknown keys, identity)
- [x] 3.4 `WorkspaceFiles` interface and the `java.nio` implementation in `jvmCommonMain`
- [x] 3.5 Fixture test: each fixture document and log line is valid; invalid samples fail

## 4. Merge

- [x] 4.1 View types (`View.kt`) with snake_case JSON names
- [x] 4.2 `Order.kt`, `Priority.kt`, `Keys.kt`, `Presence.kt`, `Snapshot.kt`, `WorkspaceFold.kt`, `TaskFold.kt`
- [x] 4.3 `LogSource.kt` (incremental read, head and tail checks) and `MergeEngine.kt` (held lines, duplicates, folds, assembly, issues, mutex, all-or-nothing)
- [x] 4.4 Merge case test: each case equals `expected.json`, for 40 read orders; the AW-7 snapshot equals `task.yaml`
- [x] 4.5 Incremental tests: the random property test (3 seeds x 60 rounds), truncation, replacement, removal, a failed read

## 5. Index

- [x] 5.1 Room 3 entities, DAO and `WorkspaceIndexDatabase` in `commonMain`; database builders for the JVM and Android
- [x] 5.2 `WorkspaceIndex` (write, rebuild) and the queries: needs you, tasks by project and stage, thread by HLC
- [x] 5.3 Index tests: the queries on the base case, incremental equals rebuild

## 6. Repository and docs

- [x] 6.1 `android/Taskfile.yaml` `check` (root `task android:check`, part of `task check`), CI job `android` with a path filter, pre-commit ktlint hook
- [x] 6.2 Docs: `tech-stack.md` (rows and versions), `engineering-rules.md` 12 (ktlint, detekt), `phase-1.md` 11, `fixtures/README.md`, `AGENTS.md` status if needed
- [x] 6.3 `task check`, `:shared:jvmTest`, lint on this Mac; the Android compile on the Linux test server; break each new test once
