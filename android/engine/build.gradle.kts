// The sync engine of the Android app (docs/phase-1.md 6.7): the pins and the build of libawsync.so
// (engine-version.properties, scripts/build-libawsync.sh) and the Kotlin engine controller. The
// controller code is in jvmCommonMain, which the JVM and Android targets share, so the JVM tests run
// on a computer with no Android SDK: `./gradlew :engine:jvmTest`.
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

/** The engine pins of the computers; a test checks that the Android tag is the same. */
val desktopPins: File = rootDir.resolve("../plugins/sync-syncthing/engine/engine.json").canonicalFile

kotlin {
    jvmToolchain(
        libs.versions.jdk
            .get()
            .toInt(),
    )

    android {
        namespace = "com.agentworkspace.engine"
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
                    api(project(":shared"))
                    api(libs.ktor.client.core)
                    implementation(libs.ktor.client.okhttp)
                    api(libs.kermit)
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
                implementation(libs.ktor.client.mock)
            }
        }
    }
}

tasks.withType<Test>().configureEach {
    systemProperty("aw.schema.dir", contractsDir.path)
    systemProperty("aw.engine.desktopPins", desktopPins.path)
    systemProperty("aw.engine.versionFile", projectDir.resolve("engine-version.properties").path)
    inputs.dir(contractsDir.resolve("fixtures"))
    inputs.file(desktopPins)
    inputs.file(projectDir.resolve("engine-version.properties"))
    // The opt-in contract run with a real engine binary (RealEngineTest).
    val engineBinary = providers.gradleProperty("aw.engineBinary").orElse("")
    inputs.property("aw.engineBinary", engineBinary)
    systemProperty("aw.engine.binary", engineBinary.get())
    testLogging {
        events("failed")
        exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
    }
}

// The build of libawsync.so (docs/tech-stack.md 1.2). It needs the NDK of the version file:
// ANDROID_NDK_HOME, or ANDROID_HOME with ndk/<version>. The work folder holds Go, the source and the Go
// caches (about 2 GB); remove it after the build. The app module packs the output folder.
val engineWorkDir: Provider<String> =
    providers.gradleProperty("aw.engineWorkDir").orElse(layout.buildDirectory.dir("engine-work").map { it.asFile.path })
val engineLibsDir = layout.buildDirectory.dir("jniLibs")

tasks.register<Exec>("buildEngineLibs") {
    group = "build"
    description = "Builds libawsync.so for arm64-v8a and x86_64 from the pinned Syncthing source"
    val script = projectDir.resolve("scripts/build-libawsync.sh")
    inputs.file(script)
    inputs.file(projectDir.resolve("engine-version.properties"))
    outputs.dir(engineLibsDir)
    executable = script.path
    argumentProviders.add(CommandLineArgumentProvider { listOf(engineWorkDir.get(), engineLibsDir.get().asFile.path) })
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
