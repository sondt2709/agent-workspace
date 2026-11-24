package com.agentworkspace.android

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.agentworkspace.engine.EngineState
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

/**
 * The one foreground service of type `specialUse` that runs the sync engine while the phone has a
 * workspace (docs/phase-1.md 6.7.5 and 6.7.6). Its notification is permanent and low priority:
 * "AW · syncing with 2 devices". In the battery mode "Restricted", it shows the warning and opens the
 * app settings.
 */
class SyncEngineService : Service() {
    private var job: Job? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        val manager = getSystemService(NotificationManager::class.java)
        val channel =
            NotificationChannel(
                CHANNEL_ID,
                getString(R.string.channel_sync),
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = getString(R.string.channel_sync_description)
                setShowBadge(false)
            }
        manager.createNotificationChannel(channel)
        // The type specialUse exists from API 34. Before it, 0 means the type of the manifest.
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) SPECIAL_USE else 0
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(EngineState.STARTING), type)
    }

    override fun onStartCommand(
        intent: Intent?,
        flags: Int,
        startId: Int,
    ): Int {
        val graph = graph
        if (!graph.engine.hasWorkspace()) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (job == null) {
            job =
                graph.scope.launch {
                    graph.engine.start()
                    launch { graph.engine.state.collectLatest { show(it) } }
                    // The battery mode and the peer count change with no engine event.
                    while (true) {
                        delay(REFRESH_MS)
                        show(graph.engine.state.value)
                    }
                }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        job?.cancel()
        job = null
        val graph = graph
        graph.scope.launch { graph.engine.stop() }
        super.onDestroy()
    }

    private fun show(state: EngineState) {
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification(state))
    }

    private fun notification(state: EngineState): Notification {
        val graph = graph
        val restricted = graph.battery.isRestricted()
        val title =
            when (state) {
                EngineState.RUNNING -> {
                    val count = graph.engine.peerCount()
                    resources.getQuantityString(R.plurals.sync_running, count, count)
                }

                EngineState.NOT_INSTALLED -> {
                    getString(R.string.sync_not_installed)
                }

                EngineState.FAILED -> {
                    getString(R.string.sync_failed)
                }

                else -> {
                    getString(R.string.sync_starting)
                }
            }
        val open =
            if (restricted) {
                graph.battery.settingsIntent()
            } else {
                Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
        val builder =
            NotificationCompat
                .Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_sync)
                .setContentTitle(title)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
                .setContentIntent(
                    PendingIntent.getActivity(
                        this,
                        0,
                        open,
                        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
                    ),
                )
        if (restricted) {
            val text = getString(R.string.battery_restricted)
            builder.setContentText(text).setStyle(NotificationCompat.BigTextStyle().bigText(text))
        }
        return builder.build()
    }

    companion object {
        private const val CHANNEL_ID = "aw-sync"
        private const val NOTIFICATION_ID = 1
        private const val REFRESH_MS = 60_000L

        @SuppressLint("InlinedApi")
        private const val SPECIAL_USE = ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE

        fun start(context: Context) {
            ContextCompat.startForegroundService(context, Intent(context, SyncEngineService::class.java))
        }
    }
}
