// The logic of the phone screens (docs/phase-1.md 10): screen states, gate rules, routes, width
// classes, shortcuts, the phone actions, the credential outbox and its age sealer, the push file and
// the phone pairing (docs/phase-1.md 7). The app module (:app) is only Compose and Android glue, so
// this logic runs in JVM tests on a computer with no Android SDK: `./gradlew :control:jvmTest`.
import dev.detekt.gradle.Detekt

plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.android.kmp.library)
    alias(libs.plugins.android.lint)
    alias(libs.plugins.detekt)
}

/** The language-neutral contract of the repository (contracts/): the workspace fixture of the tests. */
val contractsDir: File = rootDir.resolve("../contracts").canonicalFile

kotlin {
    jvmToolchain(
        libs.versions.jdk
            .get()
            .toInt(),
    )

    android {
        namespace = "com.agentworkspace.control"
        compileSdk =
            libs.versions.android.compile.sdk
                .get()
                .toInt()
        minSdk =
            libs.versions.android.min.sdk
                .get()
                .toInt()
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
    }

    sourceSets {
        commonMain {
            dependencies {
                implementation(libs.kotlinx.serialization.json)
                implementation(libs.kotlinx.coroutines.core)
            }
        }
        val jvmCommonMain =
            create("jvmCommonMain") {
                dependsOn(commonMain.get())
                dependencies {
                    api(project(":engine"))
                    api(project(":identity"))
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
    }
}

tasks.withType<Test>().configureEach {
    systemProperty("aw.schema.dir", contractsDir.path)
    inputs.dir(contractsDir.resolve("fixtures"))
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
    exclude { it.file.path.contains("/build/generated/") }
}

// The lint of `task android:check`: each source set, and the JVM compilations with type resolution.
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
