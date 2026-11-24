package com.agentworkspace.control

import com.agentworkspace.shared.files.NioWorkspaceFiles
import com.agentworkspace.shared.files.NioWorkspaceWriter
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.ExperimentalPathApi
import kotlin.io.path.deleteRecursively
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** The UnifiedPush calls, in memory. */
private class FakeConnector(
    var hasDistributor: Boolean = true,
) : PushConnector {
    val calls = mutableListOf<String>()

    override fun register(
        instance: String,
        vapidKey: String,
    ) {
        calls.add("register $instance ${vapidKey.take(4)}")
    }

    override fun unregister(instance: String) {
        calls.add("unregister $instance")
    }

    override fun useDistributor() = hasDistributor

    override fun distributor() = "org.example.distributor"
}

@OptIn(ExperimentalCoroutinesApi::class)
class PushRegistrationsTest {
    private val roots = mutableMapOf<String, Path>()
    private val fixtures = mutableListOf<TestWorkspace>()
    private val connector = FakeConnector()
    private val wrote = mutableListOf<String>()
    private val clock = TestClock(1_795_400_000_000)
    private val vapid = "B" + "a".repeat(86)
    private val newKey = "B" + "b".repeat(86)

    private fun root(ws: String): Path = roots.getOrPut(ws) { Files.createTempDirectory("aw-push-") }

    private fun registrations(
        scope: TestScope,
        reload: (String) -> WorkspaceSnapshot = { WorkspaceSnapshot.empty(it, PHONE) },
    ) = PushRegistrations(
        connector = connector,
        files = { NioWorkspaceFiles(root(it)) },
        writer = { NioWorkspaceWriter(root(it)) },
        snapshot = { reload(it) },
        wrote = { ws, path -> wrote.add("$ws $path") },
        phone = { PHONE },
        time = clock,
        io = UnconfinedTestDispatcher(scope.testScheduler),
    )

    /** The fixture snapshot as workspace [ws], with ubuntu-01 publishing [key]. */
    private suspend fun TestScope.snapshot(
        ws: String,
        key: String = vapid,
    ): WorkspaceSnapshot {
        // The fixture stays open until the end of the test: the model reads it in the background.
        val fixture = TestWorkspace().also(fixtures::add)
        fixture.refresh()
        val s = fixture.model(backgroundScope).reload()
        val ubuntu = JsonObject(s.bindings.getValue("ubuntu-01") + ("vapid_public_key" to JsonPrimitive(key)))
        val bindings = s.bindings + ("ubuntu-01" to ubuntu)
        return s.copy(workspace = ws, bindings = bindings)
    }

    private fun pushFile(ws: String) = PushFile.read(NioWorkspaceFiles(root(ws)), PHONE)

    @OptIn(ExperimentalPathApi::class)
    @AfterTest
    fun cleanup() {
        roots.values.forEach { it.deleteRecursively() }
        fixtures.forEach { it.close() }
    }

    @Test
    fun everyJoinedWorkspaceRegisters() =
        runTest {
            val push = registrations(this)
            val a = MutableStateFlow(snapshot(A))
            val b = MutableStateFlow(snapshot(B))
            val joined = MutableStateFlow(listOf(A))
            // In the test scope (advanceUntilIdle does not run the work of backgroundScope).
            val job = push.follow(joined, { if (it == A) a else b }, this)
            advanceUntilIdle()
            assertEquals(listOf("register $A/ubuntu-01 Baaa"), connector.calls)
            // A second workspace joins; it is not the shown one, and it registers too.
            joined.value = listOf(A, B)
            advanceUntilIdle()
            assertEquals(listOf("register $A/ubuntu-01 Baaa", "register $B/ubuntu-01 Baaa"), connector.calls)
            assertEquals(PushState.REGISTERING, push.state.value)

            // Each endpoint goes to push.yaml of its own workspace.
            push.onEndpoint("$B/ubuntu-01", PushEndpoint("https://push.example/b", "p-b", "a-b"))
            assertEquals(listOf("https://push.example/b"), pushFile(B).subscriptions.map { it.endpoint })
            assertTrue(pushFile(A).subscriptions.isEmpty())
            assertEquals(PushState.REGISTERING, push.state.value)
            push.onEndpoint("$A/ubuntu-01", PushEndpoint("https://push.example/a", "p-a", "a-a"))
            assertEquals(listOf("https://push.example/a"), pushFile(A).subscriptions.map { it.endpoint })
            assertEquals("org.example.distributor", pushFile(A).subscriptions.single().distributor)
            assertEquals(PushState.ON, push.state.value)
            assertEquals(listOf("$B tasks/devices/$PHONE/push.yaml", "$A tasks/devices/$PHONE/push.yaml"), wrote)

            // A refresh with the same key registers nothing again.
            a.value = a.value.copy(issues = emptyList(), gateTexts = mapOf("x" to "y"))
            advanceUntilIdle()
            assertEquals(2, connector.calls.size)
            job.cancel()
        }

    @Test
    fun anEndpointInAColdProcessKeepsTheKeyOfPushYaml() =
        runTest {
            // A process that registered before wrote push.yaml.
            PushRegistry.write(
                NioWorkspaceWriter(root(A)),
                PushFile(PHONE, listOf(PushSubscription("ubuntu-01", "https://old", "p", "a", vapid, null, "t"))),
            )
            // The new process: no request, no loaded snapshot (review android-ui H2).
            val push = registrations(this)
            push.onEndpoint("$A/ubuntu-01", PushEndpoint("https://push.example/new", "p2", "a2"))
            val sub = pushFile(A).subscriptions.single()
            assertEquals("https://push.example/new", sub.endpoint)
            assertEquals(vapid, sub.vapidPublicKey)
        }

    @Test
    fun anEndpointWithNoPushYamlTakesTheKeyOfTheIndex() =
        runTest {
            val loaded = snapshot(B)
            val push = registrations(this) { loaded }
            push.onEndpoint("$B/ubuntu-01", PushEndpoint("https://push.example/b", "p", "a"))
            assertEquals(vapid, pushFile(B).subscriptions.single().vapidPublicKey)
            // With no key anywhere, the endpoint is dropped (and logged), and nothing is written.
            val none = registrations(this)
            none.onEndpoint("$A/ubuntu-01", PushEndpoint("https://push.example/a", "p", "a"))
            assertFalse(Files.exists(root(A).resolve("tasks/devices/$PHONE/push.yaml")))
        }

    @Test
    fun aFailedRegistrationShowsAndIsNotSentAgain() =
        runTest {
            val push = registrations(this)
            val s = snapshot(A)
            push.update(s)
            assertEquals(PushState.REGISTERING, push.state.value)
            push.onFailed("$A/ubuntu-01")
            assertEquals(PushState.FAILED, push.state.value)
            // The next refreshes do not register the same key again (review android-ui M2).
            push.update(s)
            push.update(s)
            assertEquals(1, connector.calls.size)
            assertEquals(PushState.FAILED, push.state.value)
            // A new key of the computer registers again.
            push.update(snapshot(A, newKey))
            assertEquals("register $A/ubuntu-01 Bbbb", connector.calls.last())
            assertEquals(PushState.REGISTERING, push.state.value)
        }

    @Test
    fun oneEndpointDoesNotHideAFailedComputerOfTheWorkspace() =
        runTest {
            val push = registrations(this)
            // Two computers publish a key (review phone-workspaces L5).
            val one = snapshot(A)
            val ubuntu = one.bindings.getValue("ubuntu-01")
            val s = one.copy(bindings = one.bindings + ("macbook-pro" to ubuntu))
            push.update(s)
            assertEquals(PushState.REGISTERING, push.state.value)
            push.onFailed("$A/macbook-pro")
            push.onEndpoint("$A/ubuntu-01", PushEndpoint("https://push.example.com/u", "p", "a"))
            assertEquals(PushState.FAILED, push.state.value)
        }

    @Test
    fun anAppOpenRegistersAFailedKeyAgain() =
        runTest {
            val push = registrations(this)
            val s = snapshot(A)
            push.update(s)
            push.onFailed("$A/ubuntu-01")
            push.update(s)
            assertEquals(1, connector.calls.size)
            // Play services came back; the person opens the app (review phone-workspaces M1).
            push.retryFailed()
            push.update(s)
            assertEquals(listOf("register $A/ubuntu-01 Baaa", "register $A/ubuntu-01 Baaa"), connector.calls)
            assertEquals(PushState.REGISTERING, push.state.value)
        }

    @Test
    fun aPhoneWithNoDistributorShowsPushOff() =
        runTest {
            connector.hasDistributor = false
            val push = registrations(this)
            push.update(snapshot(A))
            assertEquals(PushState.NO_DISTRIBUTOR, push.state.value)
            assertTrue(connector.calls.isEmpty())
        }

    @Test
    fun aComputerWithNoKeyIsRemoved() =
        runTest {
            val push = registrations(this)
            push.onEndpoint("$A/ubuntu-01", PushEndpoint("https://x", "p", "a"))
            assertTrue(pushFile(A).subscriptions.isEmpty()) // no key yet: dropped
            PushRegistry.write(
                NioWorkspaceWriter(root(A)),
                PushFile(PHONE, listOf(PushSubscription("mac-mini-lab", "https://m", "p", "a", vapid, null, "t"))),
            )
            push.update(snapshot(A))
            assertTrue("unregister $A/mac-mini-lab" in connector.calls)
            assertTrue(pushFile(A).subscriptions.none { it.computer == "mac-mini-lab" })
        }

    @Test
    fun theStateOfThePhoneIsTheWorstStateOfItsWorkspaces() {
        assertEquals(PushState.WAITING_FOR_COMPUTERS, PushState.combine(emptyList()))
        assertEquals(PushState.ON, PushState.combine(listOf(PushState.ON, PushState.WAITING_FOR_COMPUTERS)))
        assertEquals(PushState.REGISTERING, PushState.combine(listOf(PushState.ON, PushState.REGISTERING)))
        assertEquals(PushState.FAILED, PushState.combine(listOf(PushState.REGISTERING, PushState.FAILED)))
        assertEquals(PushState.NO_DISTRIBUTOR, PushState.combine(listOf(PushState.FAILED, PushState.NO_DISTRIBUTOR)))
    }

    private companion object {
        const val PHONE = TestWorkspace.PHONE
        const val A = "01a20775-5cf4-779a-a960-5e221c27fd6a"
        const val B = "01a20775-67ed-7737-83e7-202c0ff9fc7f"
    }
}
