package com.agentworkspace.android.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import com.agentworkspace.android.R
import com.agentworkspace.control.PushPreview
import com.agentworkspace.control.ResolvedNotifications
import com.agentworkspace.control.WorkspaceSnapshot

/**
 * The notification of a gate push: the title is the task key and the gate name, the text is the
 * preview line. A tap opens the workspace of the push and the task (`[Inbox, Task(id)]`). The tag
 * is the event id, so a second push of the same gate replaces the notification.
 */
object GateNotifications {
    const val EXTRA_TASK = "com.agentworkspace.android.TASK"
    const val EXTRA_WORKSPACE = "com.agentworkspace.android.WORKSPACE"

    /** The not exported alias of MainActivity: the only component that reads the extras above. */
    const val OPEN_ALIAS = "com.agentworkspace.android.OpenFromNotification"
    private const val CHANNEL_ID = "aw-gates"
    private const val NOTIFICATION_ID = 2

    /** Removes each shown gate notification whose gate [snapshot] shows as resolved (verify-journeys low 15). */
    fun cancelResolved(
        context: Context,
        snapshot: WorkspaceSnapshot,
    ) {
        val manager = context.getSystemService(NotificationManager::class.java)
        val shown = manager.activeNotifications.filter { it.id == NOTIFICATION_ID }.mapNotNull { it.tag }
        ResolvedNotifications.of(snapshot, shown).forEach { manager.cancel(it, NOTIFICATION_ID) }
    }

    fun createChannel(context: Context) {
        val channel =
            NotificationChannel(
                CHANNEL_ID,
                context.getString(R.string.channel_gates),
                NotificationManager.IMPORTANCE_HIGH,
            ).apply { description = context.getString(R.string.channel_gates_description) }
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    /** Shows the notification of a push of [workspace] (from the instance name `<workspace>/<computer>`). */
    fun show(
        context: Context,
        preview: PushPreview,
        workspace: String?,
    ) {
        createChannel(context)
        val open =
            Intent()
                .setClassName(context, OPEN_ALIAS)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                .apply {
                    preview.task?.let { putExtra(EXTRA_TASK, it) }
                    workspace?.let { putExtra(EXTRA_WORKSPACE, it) }
                }
        val notification =
            NotificationCompat
                .Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_sync)
                .setContentTitle(preview.title)
                .setContentText(preview.text)
                .setStyle(NotificationCompat.BigTextStyle().bigText(preview.text))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setAutoCancel(true)
                .setContentIntent(
                    PendingIntent.getActivity(
                        context,
                        preview.tag.hashCode(),
                        open,
                        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
                    ),
                ).build()
        context.getSystemService(NotificationManager::class.java).notify(preview.tag, NOTIFICATION_ID, notification)
    }
}
