// The lint rules of each module (docs/engineering-rules.md 5.1): ktlint (ktlint_official, read from
// .editorconfig) through Spotless, and detekt, each with 0 findings allowed.
plugins {
    alias(libs.plugins.kotlin.multiplatform) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.android.kmp.library) apply false
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.lint) apply false
    alias(libs.plugins.ksp) apply false
    alias(libs.plugins.spotless)
    alias(libs.plugins.detekt) apply false
}

spotless {
    kotlin {
        target(
            "shared/src/**/*.kt",
            "identity/src/**/*.kt",
            "engine/src/**/*.kt",
            "control/src/**/*.kt",
            "app/src/**/*.kt",
        )
        // A composable function is named like a type (Compose API guidelines).
        ktlint(libs.versions.ktlint.get())
            .setEditorConfigPath(rootDir.resolve("../.editorconfig"))
            .editorConfigOverride(mapOf("ktlint_function_naming_ignore_when_annotated_with" to "Composable"))
    }
    kotlinGradle {
        target(
            "*.gradle.kts",
            "shared/*.gradle.kts",
            "identity/*.gradle.kts",
            "engine/*.gradle.kts",
            "control/*.gradle.kts",
            "app/*.gradle.kts",
        )
        ktlint(libs.versions.ktlint.get())
    }
}
