package com.agentworkspace.android.push

import com.agentworkspace.android.graph
import com.agentworkspace.control.PushPreview
import org.unifiedpush.android.connector.FailedReason
import org.unifiedpush.android.connector.PushService
import org.unifiedpush.android.connector.data.PushEndpoint
import org.unifiedpush.android.connector.data.PushMessage

/**
 * The UnifiedPush receiver of the app. The connector decrypts each Web Push message (RFC 8291) with
 * the keys of the instance. A gate push shows a notification at once and starts a short sync, so the
 * card has the full text when the person opens it (docs/phase-1.md 8.4).
 */
class AwPushService : PushService() {
    override fun onNewEndpoint(
        endpoint: PushEndpoint,
        instance: String,
    ) = graph.push.onEndpoint(instance, endpoint)

    override fun onMessage(
        message: PushMessage,
        instance: String,
    ) {
        val preview = PushPreview.parse(if (message.decrypted) message.content else ByteArray(0))
        GateNotifications.show(this, preview, graph.push.workspaceOf(instance))
        graph.push.wake()
    }

    override fun onRegistrationFailed(
        reason: FailedReason,
        instance: String,
    ) = graph.push.onFailed(instance)

    override fun onUnregistered(instance: String) = graph.push.onUnregistered(instance)
}
