// The Android app (docs/phase-1.md 6.7 and 10). android-engine adds the engine glue: the foreground
// service, the engine launcher, the Unix socket, the battery check. android-ui adds the Compose
// screens and the push receiver; their logic is in :control. android-pairing adds the pairing screen,
// the QR scanner adapter and the Keystore box of the device key.
// The app packs libawsync.so from :engine:buildEngineLibs, or from the folder of the Gradle property
// aw.engineLibsDir (a build of another computer). The built files are never in git.
import dev.detekt.gradle.Detekt
import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.detekt)
    alias(libs.plugins.roborazzi)
}

/** The Syncthing tag of the engine, for the license and source link of the app (docs/phase-1.md 6.7.2). */
val syncthingTag: String =
    Properties()
        .also { props -> rootDir.resolve("engine/engine-version.properties").inputStream().use { props.load(it) } }
        .getProperty("SYNCTHING_TAG")

/** The libawsync.so folder (jniLibs layout: <abi>/libawsync.so). */
val engineLibsDir: String? = providers.gradleProperty("aw.engineLibsDir").orNull

android {
    namespace = "com.agentworkspace.android"
    compileSdk =
        libs.versions.android.compile.sdk
            .get()
            .toInt()
    compileSdkMinor =
        libs.versions.android.compile.minor
            .get()
            .toInt()

    defaultConfig {
        applicationId = "com.agentworkspace.android"
        minSdk =
            libs.versions.android.min.sdk
                .get()
                .toInt()
        targetSdk =
            libs.versions.android.target.sdk
                .get()
                .toInt()
        // CI owns the version fields (AGENTS.md): the release pipeline writes the release version here.
        versionCode = 1
        versionName = "0.0.0"
        ndk {
            abiFilters += listOf("arm64-v8a", "x86_64")
        }
        resValue("string", "syncthing_tag", syncthingTag)
    }

    sourceSets {
        getByName("main") {
            jniLibs.directories.add(
                engineLibsDir ?: project(":engine")
                    .layout.buildDirectory
                    .dir("jniLibs")
                    .get()
                    .asFile.path,
            )
        }
    }

    packaging {
        // The engine is an executable: the installer must extract it, so the app can run it
        // (docs/phase-1.md 6.7.1).
        jniLibs.useLegacyPackaging = true
    }

    lint {
        // Also the code of :engine and :shared (API levels against minSdk 29), and 0 warnings allowed.
        checkDependencies = true
        warningsAsErrors = true
    }

    testOptions {
        // Compose tests and Roborazzi screenshots on the JVM with Robolectric (openspec phone-desktop-parity).
        unitTests.isIncludeAndroidResources = true
    }

    buildFeatures {
        compose = true
        resValues = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }
}

kotlin {
    jvmToolchain(
        libs.versions.jdk
            .get()
            .toInt(),
    )
    compilerOptions {
        allWarningsAsErrors.set(true)
    }
}

// The golden screenshots of `task android:screenshots` (openspec phone-desktop-parity).
roborazzi {
    outputDir.set(file("src/test/screenshots"))
}

// The JVM tests of the screens read the shared fixtures (contracts/fixtures/merge).
val contractsDir: File = rootDir.resolve("../contracts").canonicalFile
tasks.withType<Test>().configureEach {
    systemProperty("aw.schema.dir", contractsDir.path)
    inputs.dir(contractsDir.resolve("fixtures"))
}

dependencies {
    implementation(project(":engine"))
    implementation(project(":control"))
    implementation(libs.androidx.core)
    implementation(libs.kotlinx.coroutines.core)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.serialization.json)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.material3)
    implementation(libs.compose.navigation.suite)
    implementation(libs.activity.compose)
    implementation(libs.adaptive)
    implementation(libs.adaptive.layout)
    implementation(libs.adaptive.navigation3)
    implementation(libs.navigation3.runtime)
    implementation(libs.navigation3.ui)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.lifecycle.viewmodel.compose)
    // Web Push through UnifiedPush (docs/phase-1.md 8): the embedded FCM distributor registers with
    // the VAPID key of each computer, so the app needs no Firebase config file.
    implementation(libs.unifiedpush.connector)
    implementation(libs.unifiedpush.fcm)
    // The QR scan of a pairing code (docs/tech-stack.md 1.5): the ML Kit code scanner of Play services,
    // behind the adapter QrScanner; with no Play services the screen shows the paste field only.
    implementation(libs.code.scanner)
    // Markdown of Claude output (openspec polish-prototype-style, docs/tech-stack.md 2.5).
    implementation(libs.markdown.renderer.m3)

    testImplementation(platform(libs.compose.bom))
    testImplementation(libs.compose.ui.test.junit4)
    testImplementation(libs.junit4)
    testImplementation(libs.robolectric)
    testImplementation(libs.roborazzi)
    testImplementation(libs.roborazzi.compose)
    testImplementation(libs.roborazzi.junit.rule)
    debugImplementation(libs.compose.ui.test.manifest)
}

if (engineLibsDir == null) {
    tasks.named("preBuild") { dependsOn(":engine:buildEngineLibs") }
}

// The Firebase config of push (task push-fcm) comes only from a local file outside the repository
// (Gradle property aw.googleServicesJson). The embedded FCM distributor 3.x registers with the VAPID
// key as the sender, so the build does not read this file (android-ui); the check stays for a later
// distributor that needs it.
val googleServicesJson: String? = providers.gradleProperty("aw.googleServicesJson").orNull
val repositoryDir: String = rootDir.resolve("..").canonicalPath
tasks.register("checkPushConfig") {
    group = "verification"
    description = "Checks that the Firebase config file of aw.googleServicesJson exists outside the repository"
    val path = googleServicesJson
    val repo = repositoryDir
    doLast {
        if (path == null) {
            logger.lifecycle("No aw.googleServicesJson: the build has no push config")
            return@doLast
        }
        val file = File(path).canonicalFile
        check(file.isFile) { "aw.googleServicesJson: no file at $file" }
        check(!file.path.startsWith("$repo/")) { "aw.googleServicesJson must be outside the repository: $file" }
    }
}

detekt {
    buildUponDefaultConfig = true
    config.setFrom(rootDir.resolve("detekt.yaml"), projectDir.resolve("detekt-compose.yaml"))
}

// The lint of `task android:check` with no Android SDK: the app sources without type resolution. The
// full Android build (with the SDK) compiles them.
tasks.register<Detekt>("detektAll") {
    group = "verification"
    description = "Runs detekt on the app sources without type resolution"
    setSource(files("src/main/kotlin"))
    config.setFrom(rootDir.resolve("detekt.yaml"), projectDir.resolve("detekt-compose.yaml"))
    buildUponDefaultConfig = true
}
