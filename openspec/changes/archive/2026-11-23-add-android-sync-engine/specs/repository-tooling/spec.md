## MODIFIED Requirements

### Requirement: Android checks
`task android:check` SHALL run, in `android/`, the Spotless check (ktlint `ktlint_official`), detekt and the JVM tests of `:shared` and `:engine`, each with 0 findings allowed. detekt SHALL also check the source of `:app` without type resolution, so the check needs no Android SDK. The CI job `android` SHALL run the same Gradle tasks on the JDK 21 toolchain when a change touches `android/**`, `shared/schema/**`, `contracts/**`, `plugins/sync-syncthing/engine/**` (the engine pins that the Android tests compare) or the workflow file, and SHALL be skipped otherwise; "CI OK" accepts a skipped job. The root `task check` SHALL run `task android:check`. A pre-commit hook SHALL run the ktlint check on staged Kotlin files.

#### Scenario: ktlint finding
- **WHEN** a Kotlin file of `android/` breaks a ktlint rule
- **THEN** `task android:check` fails and names the file and the rule

#### Scenario: detekt finding
- **WHEN** a Kotlin file of `android/` has a detekt finding
- **THEN** `task android:check` fails and names the file and the rule

#### Scenario: Change outside the Android paths
- **WHEN** a pull request changes only `daemon/**`
- **THEN** the job `android` is skipped and "CI OK" passes

#### Scenario: No Android SDK
- **WHEN** `task android:check` runs on a computer with a JDK 21 and no Android SDK
- **THEN** the check runs the JVM tests of `:shared` and `:engine` and lints `:app`, and passes
