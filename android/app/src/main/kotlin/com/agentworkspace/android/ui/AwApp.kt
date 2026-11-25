package com.agentworkspace.android.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.adaptive.ExperimentalMaterial3AdaptiveApi
import androidx.compose.material3.adaptive.currentWindowAdaptiveInfoV2
import androidx.compose.material3.adaptive.layout.calculatePaneScaffoldDirectiveWithTwoPanesOnMediumWidth
import androidx.compose.material3.adaptive.navigation3.ListDetailSceneStrategy
import androidx.compose.material3.adaptive.navigation3.rememberListDetailSceneStrategy
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteScaffold
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteType
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.runtime.rememberSaveableStateHolderNavEntryDecorator
import androidx.navigation3.ui.NavDisplay
import com.agentworkspace.android.R
import com.agentworkspace.control.InboxItems
import com.agentworkspace.control.NavKind
import com.agentworkspace.control.Route
import com.agentworkspace.control.ScreenStates
import com.agentworkspace.control.Tab
import com.agentworkspace.control.WidthClass
import com.agentworkspace.control.WorkspaceSnapshot
import com.agentworkspace.engine.EngineState

private const val NOT_HERE = "This task is not on this phone yet. It arrives with the next sync."

private val TAB_ICONS =
    mapOf(
        Tab.HOME to R.drawable.ic_home,
        Tab.INBOX to R.drawable.ic_inbox,
        Tab.TASKS to R.drawable.ic_tasks,
        Tab.DEVICES to R.drawable.ic_devices,
    )

/**
 * The root of the app: the navigation suite (a bar, a rail or a drawer by the width class) and the
 * one back stack in a list-detail scene (Inbox and Tasks with a detail placeholder from medium
 * width). A task opens as the task page in one pane at each width (openspec task-review-layout).
 * The shortcuts work on each screen.
 */
@OptIn(ExperimentalMaterial3AdaptiveApi::class, ExperimentalLayoutApi::class)
@Composable
fun AwApp(vm: AppViewModel) {
    val info = currentWindowAdaptiveInfoV2()
    val width = WidthClass.of(info.windowSizeClass.minWidthDp)
    SideEffect { vm.widthClass = width }
    val snapshot by vm.snapshot.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(vm) { vm.messages.collect { snackbar.showSnackbar(it) } }
    val tab = vm.navigator.tab
    val inboxCount = snapshot?.let { ScreenStates.inbox(it).size } ?: 0
    // While the keyboard shows on a compact window, the bottom bar hides: it would sit between the
    // message box and the keyboard (openspec task-review-layout, design decision 7).
    val imeShown = WindowInsets.isImeVisible
    NavigationSuiteScaffold(
        modifier = Modifier.onPreviewKeyEvent { event -> event.shortcut()?.let(vm::shortcut) ?: false },
        layoutType =
            when (width.navigation) {
                NavKind.BAR -> if (imeShown) NavigationSuiteType.None else NavigationSuiteType.NavigationBar
                NavKind.RAIL -> NavigationSuiteType.NavigationRail
                NavKind.DRAWER -> NavigationSuiteType.NavigationDrawer
            },
        navigationSuiteItems = {
            for (t in Tab.entries) {
                item(
                    selected = t == tab,
                    onClick = { vm.select(t) },
                    icon = {
                        if (t == Tab.INBOX && inboxCount > 0) {
                            BadgedBox(badge = { Badge { Text("$inboxCount") } }) {
                                AwIcon(TAB_ICONS.getValue(t), t.label)
                            }
                        } else {
                            AwIcon(TAB_ICONS.getValue(t), t.label)
                        }
                    },
                    label = { Text(t.label) },
                )
            }
        },
    ) {
        Scaffold(
            // The task page has its own header with Back (as on the desktop).
            topBar = { if (vm.backStack.lastOrNull() !is Route.Task) TopBar(vm, tab) },
            snackbarHost = { SnackbarHost(snackbar) },
        ) { padding ->
            // The app draws edge to edge, so the window does not resize for the keyboard: the content
            // takes the keyboard height as padding, and the message box and a focused field stay above it.
            Box(
                Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .consumeWindowInsets(padding)
                    .imePadding(),
            ) {
                val current = snapshot
                if (current == null) {
                    // No workspace yet: the first screen is the pairing (docs/phase-1.md 7).
                    val pairing by vm.pairing.collectAsStateWithLifecycle()
                    PairingScreen(
                        pairing,
                        vm.joining,
                        vm.storedSlug,
                        vm::join,
                        vm::cancelPairing,
                        vm::message,
                        onClose = null,
                    )
                } else {
                    Panes(vm, current)
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TopBar(
    vm: AppViewModel,
    tab: Tab,
) {
    val workspaces by vm.workspaces.collectAsStateWithLifecycle()
    TopAppBar(
        // The workspace switcher at each width class; before a pairing, the name of the tab.
        title = {
            if (workspaces.isEmpty()) {
                Text(tab.label)
            } else {
                WorkspaceMenu(workspaces, vm::switchWorkspace) { vm.navigator.open(Route.Pairing) }
            }
        },
        navigationIcon = {
            if (vm.backStack.size > 1) IconButton(onClick = { vm.back() }) { AwIcon(R.drawable.ic_back, "Back") }
        },
        actions = {
            IconButton(onClick = { vm.syncNow() }, enabled = !vm.syncing) { AwIcon(R.drawable.ic_sync, "Sync now") }
            IconButton(onClick = { vm.navigator.open(Route.NewTask) }) { AwIcon(R.drawable.ic_add, "New task") }
        },
    )
}

@OptIn(ExperimentalMaterial3AdaptiveApi::class)
@Composable
private fun Panes(
    vm: AppViewModel,
    snapshot: WorkspaceSnapshot,
) {
    val context = LocalContext.current
    val now by vm.now.collectAsStateWithLifecycle()
    val peers by vm.peers.collectAsStateWithLifecycle()
    val engine by vm.engineState.collectAsStateWithLifecycle()
    val push by vm.pushState.collectAsStateWithLifecycle()
    val tag = stringResource(R.string.syncthing_tag)
    // Inbox and Tasks show 2 panes from medium width (spike S14; experimental API).
    val strategy =
        rememberListDetailSceneStrategy<Route>(
            directive = calculatePaneScaffoldDirectiveWithTwoPanesOnMediumWidth(currentWindowAdaptiveInfoV2()),
        )
    val openTask = vm.navigator.openTask
    val placeholder: @Composable () -> Unit = {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("Select a task") }
    }
    val answer = { task: String, gate: String, text: String, comment: String?, sent: () -> Unit ->
        vm.answer(task, gate, text, comment, sent)
    }
    val parts =
        TaskDetailParts(
            loadProposal = vm::proposalText,
            loadArtifacts = vm::artifacts,
            onDownload = vm::download,
            onOpenArtifact = vm::openArtifact,
            textSize = vm.proposalTextSize,
            onTextSize = vm::changeProposalTextSize,
        )
    NavDisplay(
        backStack = vm.backStack,
        onBack = { vm.back() },
        entryDecorators = listOf(rememberSaveableStateHolderNavEntryDecorator()),
        sceneStrategies = listOf(strategy),
        entryProvider =
            entryProvider {
                entry<Route.Home> {
                    HomeScreen(
                        home = ScreenStates.home(snapshot, peers, now),
                        snapshot = snapshot,
                        openTask = openTask,
                        syncing = vm.syncing,
                        syncText = vm.syncText,
                        battery = vm.batteryRestricted,
                        onBattery = { context.startActivity(vm.batterySettings()) },
                        onOpen = vm::openTask,
                        onSyncNow = vm::syncNow,
                        onAnswer = answer,
                    )
                }
                entry<Route.Inbox>(metadata = ListDetailSceneStrategy.listPane(detailPlaceholder = { placeholder() })) {
                    InboxScreen(
                        snapshot = snapshot,
                        updates = InboxItems.updates(peers, now),
                        openItem = vm.navigator.openInboxItem,
                        onOpenItem = { vm.navigator.open(Route.InboxItem(it)) },
                        onOpenTask = vm::openTask,
                    )
                }
                // The item screen of an Inbox row, next to the list from medium width.
                entry<Route.InboxItem>(metadata = ListDetailSceneStrategy.detailPane()) { route ->
                    val task = snapshot.task(route.task)
                    if (task == null) {
                        EmptyText(NOT_HERE)
                    } else {
                        InboxItemScreen(
                            task = task,
                            snapshot = snapshot,
                            loadThread = vm::thread,
                            parts = parts,
                            onAnswer = { gate, text, comment, sent -> vm.answer(task.id, gate, text, comment, sent) },
                            onAssign = { vm.assign(task.id, it) },
                            onOpenTask = { vm.openTask(task.id) },
                        )
                    }
                }
                entry<Route.Tasks>(metadata = ListDetailSceneStrategy.listPane(detailPlaceholder = { placeholder() })) {
                    TasksScreen(snapshot, openTask, vm::openTask, vm::syncNow) { vm.navigator.open(Route.NewTask) }
                }
                entry<Route.Devices> {
                    DevicesScreen(
                        devices =
                            ScreenStates.devices(
                                snapshot,
                                peers,
                                now,
                                engineDown = engine.takeIf { it != EngineState.RUNNING }?.let(::engineText),
                            ),
                        engine = engine,
                        push = push,
                        battery = vm.batteryRestricted,
                        issues = snapshot.issues.size,
                        syncing = vm.syncing,
                        syncText = vm.syncText,
                        syncthingTag = tag,
                        onBattery = { context.startActivity(vm.batterySettings()) },
                        onSyncNow = vm::syncNow,
                        onAddCredential = { vm.navigator.open(Route.AddCredential) },
                        onPair = { vm.navigator.open(Route.Pairing) },
                        mobileData = vm.mobileData,
                        onMobileData = vm::setMobileDataAllowed,
                        keyReplaced = vm.keyReplaced,
                        onKeyReplacedRead = vm::dismissKeyReplaced,
                    )
                }
                // The task page in one pane at each width: no list next to it and no Session pane.
                entry<Route.Task> { route ->
                    val task = snapshot.task(route.id)
                    if (task == null) {
                        EmptyText(NOT_HERE)
                    } else {
                        TaskScreen(
                            task = task,
                            snapshot = snapshot,
                            nav =
                                TaskPageNavigation(
                                    onBack = { vm.back() },
                                    onOpen = vm::openTask,
                                    listOn = vm.taskListOn,
                                    onList = { vm.taskListOn = it },
                                ),
                            loadThread = vm::thread,
                            loadTerminal = vm::terminal,
                            parts = parts,
                            actions =
                                TaskPageActions(
                                    onAnswer = { gate, text, comment, sent ->
                                        vm.answer(task.id, gate, text, comment, sent)
                                    },
                                    onAssign = { vm.assign(task.id, it) },
                                    onSend = { text, sent -> vm.sendMessage(task.id, text, sent) },
                                    onStopSession = { vm.stopSession(task.id) },
                                    onNewSession = { assignee, options -> vm.newSession(task.id, assignee, options) },
                                    onArchive = { vm.archiveTask(task.id) },
                                    onUnarchive = { vm.unarchiveTask(task.id) },
                                ),
                        )
                    }
                }
                entry<Route.NewTask>(metadata = ListDetailSceneStrategy.detailPane()) {
                    NewTaskScreen(snapshot, vm.creating, vm::createTask) { vm.back() }
                }
                entry<Route.AddCredential>(metadata = ListDetailSceneStrategy.detailPane()) {
                    CredentialScreen(vm.credentialAddAvailable, vm::addCredential) { vm.back() }
                }
                entry<Route.Pairing>(metadata = ListDetailSceneStrategy.detailPane()) {
                    val pairing by vm.pairing.collectAsStateWithLifecycle()
                    PairingScreen(pairing, vm.joining, vm.storedSlug, vm::join, vm::cancelPairing, vm::message) {
                        vm.back()
                    }
                }
            },
    )
}
