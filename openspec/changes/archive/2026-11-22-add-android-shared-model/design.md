## Context

`shared/core` (merge-index, `b3f3430`) merges the device logs of an AW folder into a `WorkspaceView`, with the ownership rules, the HLC bound, presence and an incremental reader. `contracts/fixtures/merge/<case>/expected.json` holds the expected `{view, presence}` of 7 cases. The phone must give the same view (`engineering-rules.md` 7.4.15). The development Mac has no Android SDK; a Linux test server has one. The JSON Schemas in `contracts/schemas/` are the input of the Kotlin classes (`phase-1.md` 3.4).

## Goals / Non-Goals

**Goals:**
- One Kotlin module `android/shared` with the file model, the merge and the index.
- The same view as TypeScript for each merge case, and the same incremental-equals-full property.
- Generated Kotlin classes with a drift check.
- JVM tests on a computer with no Android SDK; an Android compile on the Linux test server.

**Non-Goals:**
- UI, sync engine, push, pairing (later tasks).
- The event writer, the redaction and the YAML writer (the phone writes its own files in android-engine and android-ui).
- The MongoDB query subset for saved filters (`phase-1.md` 3.5.2). Phase 1 screens use fixed Room queries.

## Decisions

1. **Kotlin classes from the JSON Schemas, not from zod.** A new target in `shared/schema/scripts/render.ts` (`kotlinTarget`, code in `scripts/kotlin.ts`) reads the output of `z.toJSONSchema()` and writes one `.kt` file per schema entry plus one file of checks, in `android/shared/generated/kotlin/com/agentworkspace/schema/`. The JSON Schema is the published contract, and it has each type, default, enum, pattern and limit. Alternative: walk the zod internals. Rejected: an internal API, and a second interpretation of the schemas.
2. **Refines become an annotation.** `hlcText` (a real date) and `relativePath` (no `..`) are refines, and `z.toJSONSchema()` drops them. Each gets `.meta({"x-aw-check": "hlc" | "relative-path"})`. The JSON Schema then names the check (an unknown keyword is an annotation in 2020-12, so validators ignore it), and the Kotlin generator emits the same check. This also closes data-model open issue 7 for the Kotlin reader.
3. **Validation in the generated classes.** Each class is `@Serializable` with snake_case `@SerialName`s, the defaults of the schema, a `String` with a set check for each enum (no enum class: the values stay the simple shared texts), and an `init` block that checks the enums, the patterns, the limits and the `x-aw-check`s. A field that is optional and not nullable in zod (`.optional()`) has `@AwOptional` (the reader refuses a JSON null) and `@EncodeDefault(NEVER)` (a writer leaves out the key). kotlinx.serialization runs `init` on decode, so a decode is also the validation. The event union is a `sealed interface EventData` with one class per type and a `serializer(type)` lookup.
4. **Loose objects keep unknown fields.** The typed decode ignores unknown keys. The reader keeps the raw JSON and builds the value of a document as the encoded typed value (with defaults) plus each unknown key of the raw value, at each object level. This is the zod `looseObject` output, so `view.workspace` and `view.projects` equal the TypeScript values.
5. **YAML through `kotaml` into JSON, then the typed class.** `parseToYamlNode` gives the tree; a plain scalar becomes a JSON null, boolean, integer or float by the YAML 1.2 core schema (the `yaml` package of awd uses the same schema), a quoted scalar a string. Then the same JSON decode as an event line. Alternative: `Yaml.decodeFromString` into the class. Rejected: it reads `name: 123` as the text "123", and zod refuses a number there.
6. **JSON syntax errors use the V8 message text.** The issue `message` is part of the view, and the TypeScript reader shows the `JSON.parse` message of V8. `JsonSyntax.message(text)` scans a line after a failed `parseToJsonElement` and returns the V8 text for the main cases ("Unterminated string in JSON at position N (column C)", "Unexpected end of JSON input", "Unexpected token …", the expected-comma and expected-colon cases). Schema error texts differ from zod (the Kotlin text names the field and the check); no fixture has a schema error line. Alternative: leave `message` out of the comparison. Rejected: an issue row of the index uses the message in its key, so the texts must be equal for the fixtures.
7. **File access behind an interface.** `commonMain` has `WorkspaceFiles` (list a folder, size, read bytes at an offset, read text). `jvmCommonMain` implements it with `java.nio.file`, so Android and the JVM use one implementation. No new I/O library.
8. **Same structure as the TypeScript engine.** `MergeEngine.update()` is a `suspend` function behind a `Mutex` (the serial calls of round 2), all or nothing (a failed read forgets each read). The fold classes keep the TypeScript names (`TaskFold`, `foldWorkspace`, `markDuplicateKeys`, `priorityRank`, `presenceOf`, `toTaskDocument`). Text order uses `compareTo` on `String` (UTF-16 code units, the same as the JavaScript `<`).
9. **Room 3 on both targets.** `WorkspaceIndexDatabase` (`androidx.room3`) is in `commonMain` with entities `tasks`, `events`, `issues`, `documents`, `devices`, `projects` and `presence`: the JSON of the view row plus the query columns. The JVM target builds it with `BundledSQLiteDriver`, Android with the same driver and the app context. So the JVM tests run the real DAO and SQL. Alternative: a fake DAO on the JVM. Rejected: it does not test the SQL.
10. **Index writes.** `WorkspaceIndex.write(update, engine)` replaces the rows of the changed tasks (task row and events), and each row of the small tables (projects, devices, issues, presence, documents) in one transaction. `rebuild()` clears each table first. A test compares the incremental rows with a rebuilt index.
11. **Fixtures by a system property.** Gradle passes `-Daw.schema.dir=<repo>/contracts` to the JVM tests. The tests copy a merge case (the `workspace/` folder plus the `files/` overlay) to a temp folder, merge it at `case.json` `now`, and compare the parsed JSON of `{view, presence}` with `expected.json` (numbers by value, keys in any order).
12. **Property test.** A Kotlin port of `mulberry32`, `shuffle` and `RandomEvents` with the same seeds (20261122, 7, 4242) and 60 rounds. The event ids come from a Kotlin UUIDv7 function, so the files differ from the TypeScript run; the property (incremental equals full) is the same.
13. **Build.** Gradle wrapper 9.9.1 (with its sha256), AGP 9.5.1 with the `com.android.kotlin.multiplatform.library` plugin (AGP 9 has no `androidTarget()` with `com.android.library`), Kotlin 2.4.21, KSP 2.3.14, kotlinx.serialization 1.13.0, kotaml 0.113.0, Room 3.0.3, sqlite-bundled 2.7.1. Each pin is the newest release at least 7 days old on 2026-11-23 (`engineering-rules.md` 4.12). `minSdk` 29, `compileSdk` 37. The JDK 21 toolchain comes from the environment (`actions/setup-java` in CI, `-Porg.gradle.java.installations.paths` on a computer): the toolchain download plugin `foojay-resolver-convention` 1.0 (2025-05) fails rule 4.9.2.
14. **Lint.** Spotless 8.9 runs ktlint 1.8.0 with `ktlint_official` from `.editorconfig`; detekt 2.0 (`dev.detekt`) runs with `buildUponDefaultConfig` and 0 findings allowed, on each source set and on the JVM compilations with type resolution (`:shared:detektAll`). `android/detekt.yaml` raises `ReturnCount` to 4 with guard clauses, allows more functions in an object or class, ignores simple `when` entries for the complexity, and keeps the test source sets out of the size rules. Both skip `android/shared/generated/kotlin`. ktlint 1.8.0 (2025-11) and the newest stable detekt 1.23.8 (2025-02) fail rule 4.9.2; the docs already name both tools, so each gets a row in `engineering-rules.md` 12. detekt 2.0 is a pre-release line, but 1.23.8 cannot analyse Kotlin 2.4 code with types.
15. **Schema samples for Kotlin.** The valid and invalid samples of the TypeScript schema tests move to `shared/schema/src/testing/samples.ts`. A third generator target writes them to `contracts/samples/schema-samples.json`, so the Kotlin tests run the same samples and the drift check keeps the file current.
16. **No `app` module.** The Android KMP library plugin compiles `shared` alone, and the handoff asks for an `app` stub only when the build needs it. android-ui adds `app/` with the applicationId `com.agentworkspace.android`.

## Risks / Trade-offs

- [Room 3 KSP on Kotlin 2.4] → The JVM test run on this Mac proves the processor; the Linux test server proves the Android compile.
- [A V8 message case that the scanner does not copy] → The scanner covers the cases of the fixtures and of the property test; another text only changes the `message` of a `bad_line` issue, not the merge.
- [Generated code fails ktlint] → The lint tasks skip the generated folder; the generator writes a stable format and the drift test pins it.
- [Number types in the expected JSON (`1` against `1.0`)] → The test compares numbers by value.
- [detekt 2.0 pre-release] → Pinned exactly; the exception row names the review date.

## Migration Plan

New module, no data migration. Rollback: remove `android/` and the Kotlin target.

## Open Questions

None. Each decision above follows the handoff and the docs.
