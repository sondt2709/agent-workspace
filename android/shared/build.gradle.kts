// The shared Kotlin module (docs/phase-1.md 11): the file model, the merge and the index of the
// Android app. commonMain holds the logic, jvmCommonMain the java.nio file access and the Room
// database builder that the JVM and Android targets share. The JVM tests run on a computer with no
// Android SDK: `./gradlew :shared:jvmTest`.
import dev.detekt.gradle.Detekt

plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.android.kmp.library)
    alias(libs.plugins.android.lint)
    alias(libs.plugins.ksp)
    alias(libs.plugins.detekt)
}

/**
 * The language-neutral contract of the repository (contracts/): the fixtures, the test vectors and
 * the schema samples. Kotlin reads only this folder of the repository (docs/decisions/2026-11-23-repo-layout.md).
 */
val contractsDir: File = rootDir.resolve("../contracts").canonicalFile

/** The classes that `pnpm schema:generate` writes (shared/schema/scripts/kotlin.ts). */
val generatedDir: File = projectDir.resolve("generated")

kotlin {
    jvmToolchain(
        libs.versions.jdk
            .get()
            .toInt(),
    )

    android {
        namespace = "com.agentworkspace.shared"
        compileSdk =
            libs.versions.android.compile.sdk
                .get()
                .toInt()
        minSdk =
            libs.versions.android.min.sdk
                .get()
                .toInt()
        // commonTest also runs on the Android host (`testAndroidHostTest`) on a computer with the SDK.
        withHostTest {}
        // Android Lint of this code for the Android target (fix list 0-30): NewApi against minSdk, so a Java
        // API that the phone lacks fails before the app runs. `task android:lint` runs it (needs the SDK).
        lint {
            warningsAsErrors = true
            // The versions are pinned on purpose (docs/tech-stack.md); the release pipeline updates them.
            disable += setOf("NewerVersionAvailable", "AndroidGradlePluginVersion", "GradleDependency")
        }
    }
    jvm()

    compilerOptions {
        allWarningsAsErrors.set(true)
        freeCompilerArgs.add("-Xexpect-actual-classes")
    }

    sourceSets {
        commonMain {
            // The classes of `pnpm schema:generate` (shared/schema/scripts/kotlin.ts).
            kotlin.srcDir(generatedDir.resolve("kotlin"))
            dependencies {
                implementation(libs.kotlinx.serialization.json)
                implementation(libs.kotlinx.coroutines.core)
                implementation(libs.kotaml)
                implementation(libs.room3.runtime)
            }
        }
        val jvmCommonMain =
            create("jvmCommonMain") {
                dependsOn(commonMain.get())
                dependencies {
                    implementation(libs.sqlite.bundled)
                }
            }
        jvmMain { dependsOn(jvmCommonMain) }
        androidMain { dependsOn(jvmCommonMain) }
        commonTest {
            dependencies {
                implementation(kotlin("test"))
                implementation(libs.kotlinx.coroutines.test)
            }
        }
        jvmTest {
            dependencies {
                // The record check test signs records with the master key of the identity vectors.
                implementation(project(":identity"))
            }
        }
    }
}

dependencies {
    add("kspJvm", libs.room3.compiler)
    add("kspAndroid", libs.room3.compiler)
}

tasks.withType<Test>().configureEach {
    // The tests read the shared fixtures directly (contracts/fixtures, test-vectors) and the
    // schema samples of `pnpm schema:generate`. Each one is an input, so a change of only these files
    // runs the tests again (no up-to-date or build-cache result).
    systemProperty("aw.schema.dir", contractsDir.path)
    inputs.dir(contractsDir.resolve("fixtures"))
    inputs.dir(contractsDir.resolve("test-vectors"))
    inputs.file(contractsDir.resolve("samples/schema-samples.json"))
    testLogging {
        events("failed")
        exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
    }
}

detekt {
    buildUponDefaultConfig = true
    config.setFrom(rootDir.resolve("detekt.yaml"))
    parallel = true
}

tasks.withType<Detekt>().configureEach {
    // The generated classes are not linted; the drift check pins their text. A local copy of the path
    // keeps the filter free of script references (configuration cache).
    val generated = generatedDir.path
    exclude { it.file.path.startsWith(generated) || it.file.path.contains("/build/generated/") }
}

// The lint of `task android:check` and of CI: each source set, and the JVM compilations with type
// resolution. detektMainAndroid needs the Android SDK; the Android compile on a computer with the SDK
// covers that target.
tasks.register("detektAll") {
    group = "verification"
    description = "Runs detekt on each source set and on the JVM compilations"
    dependsOn(
        "detektCommonMainSourceSet",
        "detektCommonTestSourceSet",
        "detektJvmCommonMainSourceSet",
        "detektJvmMainSourceSet",
        "detektJvmTestSourceSet",
        "detektAndroidMainSourceSet",
        "detektMainJvm",
        "detektTestJvm",
    )
}
