// The identity formats and the crypto of the phone (openspec add-android-pairing): canonical JSON,
// the pairing code and request, the check code, the device record check, the phone device key and
// the age sealer. It is the twin of shared/identity; the shared vectors in
// contracts/test-vectors/identity.json prove that both give the same bytes. The code is in
// jvmCommonMain, so the JVM tests run with no Android SDK: `./gradlew :identity:jvmTest`.
import dev.detekt.gradle.Detekt

plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.android.kmp.library)
    alias(libs.plugins.android.lint)
    alias(libs.plugins.detekt)
}

/** The language-neutral contract of the repository (contracts/): the identity vectors. */
val contractsDir: File = rootDir.resolve("../contracts").canonicalFile

kotlin {
    jvmToolchain(
        libs.versions.jdk
            .get()
            .toInt(),
    )

    android {
        namespace = "com.agentworkspace.identity"
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
                api(libs.kotlinx.serialization.json)
            }
        }
        val jvmCommonMain =
            create("jvmCommonMain") {
                dependsOn(commonMain.get())
                dependencies {
                    implementation(libs.tink)
                }
            }
        jvmMain { dependsOn(jvmCommonMain) }
        androidMain { dependsOn(jvmCommonMain) }
        commonTest {
            dependencies {
                implementation(kotlin("test"))
            }
        }
    }
}

tasks.withType<Test>().configureEach {
    systemProperty("aw.contracts.dir", contractsDir.path)
    inputs.dir(contractsDir.resolve("test-vectors"))
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
