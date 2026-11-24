package com.agentworkspace.android

import android.app.Activity
import android.app.Application
import android.os.Bundle
import kotlinx.coroutines.launch

/**
 * The app process. Each time the app opens (the first started activity), the app restarts the engine
 * with the reconnect interval of 5 s and starts the foreground service; when the last activity stops,
 * the interval goes back to 20 s (docs/phase-1.md 6.2 and 6.7.5).
 */
class AwApplication :
    Application(),
    Application.ActivityLifecycleCallbacks {
    lateinit var graph: AppGraph
        private set

    private var started = 0

    override fun onCreate() {
        super.onCreate()
        graph = AppGraph(this)
        registerActivityLifecycleCallbacks(this)
    }

    override fun onActivityStarted(activity: Activity) {
        started += 1
        if (started == 1) appOpened()
    }

    override fun onActivityStopped(activity: Activity) {
        started -= 1
        if (started == 0) {
            graph.engine.markAppOpen(false)
            graph.scope.launch { graph.engine.appClosed() }
        }
    }

    private fun appOpened() {
        // The service starts while the activity is visible: Android refuses a foreground service
        // start from the background.
        if (graph.engine.hasWorkspace()) SyncEngineService.start(this)
        graph.engine.markAppOpen(true)
        graph.scope.launch { graph.engine.appOpened() }
    }

    override fun onActivityCreated(
        activity: Activity,
        savedInstanceState: Bundle?,
    ) = Unit

    override fun onActivityResumed(activity: Activity) = Unit

    override fun onActivityPaused(activity: Activity) = Unit

    override fun onActivitySaveInstanceState(
        activity: Activity,
        outState: Bundle,
    ) = Unit

    override fun onActivityDestroyed(activity: Activity) = Unit
}

/** The graph of the app process. */
val android.content.Context.graph: AppGraph get() = (applicationContext as AwApplication).graph
