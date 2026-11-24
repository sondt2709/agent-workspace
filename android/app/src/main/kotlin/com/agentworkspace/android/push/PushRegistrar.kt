package com.agentworkspace.android.push

import android.content.Context
import co.touchlab.kermit.Logger
import com.agentworkspace.android.AppGraph
import com.agentworkspace.android.SyncEngineService
import com.agentworkspace.control.PushConnector
import com.agentworkspace.control.PushEndpoint
import com.agentworkspace.control.PushRegistrations
import com.agentworkspace.control.PushRegistry
import com.agentworkspace.control.PushState
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import org.unifiedpush.android.connector.UnifiedPush
import org.unifiedpush.android.connector.data.PushEndpoint as UpEndpoint

/**
 * The push registrations of the phone (docs/phase-1.md 8.2): the UnifiedPush adapter of
 * [PushRegistrations], which registers one instance per computer and joined workspace with the VAPID
 * public key of that computer, through the embedded FCM distributor or another UnifiedPush
 * distributor (for example ntfy). The app starts it in the scope of the app process.
 */
class PushRegistrar(
    private val context: Context,
    private val graph: AppGraph,
    private val log: Logger = Logger.withTag("aw-push"),
) {
    private val connector =
        object : PushConnector {
            override fun register(
                instance: String,
                vapidKey: String,
            ) = UnifiedPush.register(context, instance, MESSAGE_FOR_DISTRIBUTOR, vapidKey)

            override fun unregister(instance: String) = UnifiedPush.unregister(context, instance)

            /**
             * Keeps the distributor that answered before; else selects one with no picker: the embedded
             * FCM distributor of this app when Play services exist, else the first UnifiedPush app (for
             * example ntfy). False when the phone has none.
             */
            override fun useDistributor(): Boolean {
                if (UnifiedPush.getAckDistributor(context) != null) return true
                val distributors = UnifiedPush.getDistributors(context)
                val chosen =
                    distributors.firstOrNull { it == context.packageName } ?: distributors.firstOrNull() ?: return false
                UnifiedPush.saveDistributor(context, chosen)
                return true
            }

            override fun distributor(): String? = UnifiedPush.getAckDistributor(context)
        }

    val registrations =
        PushRegistrations(
            connector = connector,
            files = { graph.workspace(it).files },
            writer = { graph.workspace(it).writer },
            snapshot = { graph.workspace(it).model.reload() },
            wrote = { ws, path -> graph.engine.wrote(ws, path) },
            phone = graph::deviceSlug,
            time = graph.time,
        )

    val state: StateFlow<PushState> = registrations.state

    /**
     * The push callbacks run one at a time in the order of the calls (review phone-workspaces L2):
     * an unregister and then a new endpoint of the same instance must not swap.
     */
    private val callbacks = Channel<suspend () -> Unit>(Channel.UNLIMITED)

    init {
        graph.scope.launch {
            for (work in callbacks) {
                try {
                    work()
                } catch (e: CancellationException) {
                    throw e
                } catch (
                    @Suppress("TooGenericExceptionCaught") e: Exception,
                ) {
                    log.e(e) { "A push callback failed" }
                }
            }
        }
    }

    /** A new endpoint of an instance: its subscription goes to `push.yaml` of the workspace. */
    fun onEndpoint(
        instance: String,
        endpoint: UpEndpoint,
    ) {
        val keys = endpoint.pubKeySet ?: return log.w { "The endpoint of $instance has no Web Push keys" }
        callbacks.trySend { registrations.onEndpoint(instance, PushEndpoint(endpoint.url, keys.pubKey, keys.auth)) }
    }

    fun onUnregistered(instance: String) {
        callbacks.trySend { registrations.onUnregistered(instance) }
    }

    fun onFailed(instance: String) {
        callbacks.trySend { registrations.onFailed(instance) }
    }

    /** The workspace of an instance name `<workspace>/<computer>`, or null. */
    fun workspaceOf(instance: String): String? = PushRegistry.parseInstance(instance)?.first

    /** A push arrived: start the engine for a short sync (docs/phase-1.md 8.4). */
    fun wake() {
        if (!graph.engine.hasWorkspace()) return
        try {
            SyncEngineService.start(context)
        } catch (e: IllegalStateException) {
            // Android can refuse a foreground service start from the background; the sync still runs.
            log.w(e) { "The sync service did not start from the push" }
        }
        graph.scope.launch { graph.engine.syncNow(PUSH_SYNC_MS) }
    }

    private companion object {
        const val MESSAGE_FOR_DISTRIBUTOR = "Agent Workspace gates"
        const val PUSH_SYNC_MS = 15_000L
    }
}
