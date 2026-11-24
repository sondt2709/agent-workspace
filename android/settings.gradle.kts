// The Android app of Agent Workspace (docs/phase-1.md 10 and 11). Phase 1 task android-shared adds
// the module shared/ (file model, merge, index). android-engine adds engine/ (the sync engine build
// and its controller) and the first part of app/; android-ui adds control/ (the logic of the screens)
// and the screens to app/; android-pairing adds identity/ (the identity formats and the age sealer).
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "agent-workspace-android"

include(":shared")
include(":identity")
include(":engine")
include(":control")
include(":app")
