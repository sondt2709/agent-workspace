## Why

The Android app must read the same AW folder as awd and show the same merged view (`docs/phase-1.md` 3.5.3, `engineering-rules.md` 7.4.15). The merge, the ownership rules and the index exist only in TypeScript (`shared/core`). The android-engine and android-ui tasks need a Kotlin module with the same rules before they can start.

## What Changes

- New Gradle project `android` (Kotlin DSL, version catalog, JDK 21 toolchain, Kotlin 2.4) with the Kotlin Multiplatform module `shared`: targets `jvm()` and Android, source sets `commonMain`, `jvmCommonMain` (shared by the JVM and Android targets) and `commonTest`.
- A Kotlin target in `pnpm schema:generate`: it writes Kotlin data classes from the generated JSON Schemas to `android/shared/generated/kotlin/`. The existing drift test and the CI step "Generated schemas are current" cover the new files.
- The zod schemas `hlcText` and `relativePath` get a `x-aw-check` annotation, so the generated JSON Schemas and the Kotlin classes name the checks that a pattern cannot express.
- A Kotlin port of the file model and the merge: the event envelope and the log reader (unknown types kept), the HLC, the ownership rules and the merge (`order`, `task`, `workspace`, `keys`, `priority`, `presence`), the 24 h HLC bound, the incremental update with the truncation and replacement checks, and `toTaskDocument`.
- A Room 3 index (`androidx.room3`) with the queries of the phone: the "Needs you" list, tasks by project and stage, and the thread of a task by HLC. The JVM target uses the same Room database with the bundled SQLite driver, so the tests run on a computer with no Android SDK.
- JVM tests (`:shared:jvmTest`) on the shared fixtures: the HLC vectors, each fixture document and log line, the 7 merge cases against `expected.json`, and the incremental-versus-full property test with the seeds of the TypeScript test.
- ktlint (`ktlint_official`, through Spotless) and detekt with 0 findings, `task android:check`, a pre-commit ktlint hook, and a CI job `android` with a path filter on `android/**` and `shared/schema/**`.
- No UI, no sync engine, no push and no pairing. No `app` module: the Android library plugin builds `shared` alone.

## Capabilities

### New Capabilities
- `android-shared-model`: the Kotlin module `android/shared`: generated classes, log and document readers, HLC, merge, Room index and queries, and the cross-language fixture tests.

### Modified Capabilities
- `workspace-schemas`: "Generated JSON Schemas" now also covers the generated Kotlin classes and the `x-aw-check` annotation.
- `repository-tooling`: new requirement for the Android checks (`task android:check`, ktlint and detekt, the CI job with a path filter, the pre-commit hook).

## Impact

- New folder `android/` (Gradle wrapper, `settings.gradle.kts`, `gradle/libs.versions.toml`, `shared/`, detekt config).
- `shared/schema/scripts/render.ts` and a new `shared/schema/scripts/kotlin.ts`; new generated folders `android/shared/generated/kotlin/` and `contracts/samples/`; `shared/schema/src/common.ts` (2 annotations) and 3 generated JSON Schemas (new `x-aw-check` keys only); the schema samples move from `src/schemas.test.ts` to `src/testing/samples.ts` (the TypeScript assertions do not change).
- `android/Taskfile.yaml` and the root `Taskfile.yaml` (`android:check` in `task check`), `.github/workflows/ci.yaml` (jobs `changes` and `android`), `.pre-commit-config.yaml` (ktlint hook), `.gitignore` (Gradle output), `AGENTS.md` (status and commands).
- New libraries (Kotlin): kotlinx.serialization 1.13, `kotaml` 0.113, Room 3.0 with `sqlite-bundled` 2.7, kotlinx.coroutines, KSP, Spotless with ktlint 1.8, detekt 2.0. Rows in `docs/tech-stack.md` 2.5 and 2.6; exception rows in `docs/engineering-rules.md` 12 for ktlint, detekt and kotlinx.coroutines.
- Docs: `docs/phase-1.md` 3.4 and 3.5 (Kotlin classes, the Room index of the phone), `docs/tech-stack.md` (versions and rows), `contracts/fixtures/README.md` (the Kotlin tests).
