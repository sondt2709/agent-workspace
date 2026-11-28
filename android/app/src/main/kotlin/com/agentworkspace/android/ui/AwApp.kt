package com.agentworkspace.android.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
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
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.runtime.rememberSaveableStateHolderNavEntryDecorator
import androidx.navigation3.ui.NavDisplay
import com.agentworkspace.android.R
import com.agentworkspace.control.InboxCards
import com.agentworkspace.control.InboxItems
import com.agentworkspace.control.NavKind
import com.agentworkspace.control.Pane
import com.agentworkspace.control.Route
import com.agentworkspace.control.ScreenStates
import com.agentworkspace.control.Tab
import com.agentworkspace.control.WidthClass
import com.agentworkspace.control.WorkspaceSnapshot
import com.agentworkspace.control.pane
import com.agentworkspace.engine.EngineState

/** The width of the Inbox and Tasks list pane next to a detail (docs/design.md 8.4). */
private const val LIST_PANE_DP = 320

private const val NOT_HERE = "This task is not on this phone yet. It arrives with the next sync."

private val TAB_ICONS =
    mapOf(
        Tab.HOME to R.drawable.ic_home,
        Tab.INBOX to R.drawable.ic_inbox,
        Tab.TASKS to R.drawable.ic_tasks,
        Tab.DEVICES to R.drawable.ic_devices,
    )

/** The scene metadata of a route from its [Pane] (`Route.pane` of :control). */
@OptIn(ExperimentalMaterial3AdaptiveApi::class)
private fun Route.metadata(placeholder: @Composable () -> Unit): Map<String, Any> =
    when (pane()) {
        Pane.LIST -> ListDetailSceneStrategy.listPane(detailPlaceholder = { placeholder() })
        Pane.DETAIL -> ListDetailSceneStrategy.detailPane()
        Pane.SINGLE -> emptyMap()
    }

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
    // The Inbox badge counts the unread open cards; the Tasks badge counts the tasks that need you
    // (openspec inbox-mattermost, spec inbox-cards "Phone Inbox").
    val inboxCount = snapshot?.let { InboxCards.counts(it.cards).getValue("unread") } ?: 0
    val needsCount = snapshot?.let { ScreenStates.inbox(it).size } ?: 0
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
                        val count =
                            when (t) {
                                Tab.INBOX -> inboxCount
                                Tab.TASKS -> needsCount
                                else -> 0
                            }
                        if (count > 0) {
                            BadgedBox(badge = { Badge { Text("$count") } }) {
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
            // The task page at the full width has its own header with Back (as on the desktop); next to
            // the Tasks list the top bar stays above the list (openspec phone-desktop-parity).
            topBar = {
                // Next to the Tasks list (from medium width) the list pane has its own bar, and the task
                // pane uses the full height, as in the approved prototype.
                val top = vm.backStack.lastOrNull()
                if (top !is Route.TaskPage && top !is Route.Task) TopBar(vm, tab)
            },
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

/** The bar of the Tasks list pane next to a task: the workspace switcher and "Sync now", no Back. */
@Composable
private fun ListPaneBar(vm: AppViewModel) {
    val workspaces by vm.workspaces.collectAsStateWithLifecycle()
    Row(
        Modifier.fillMaxWidth().heightIn(min = LIST_PANE_BAR_DP.dp).padding(start = 16.dp, end = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.weight(1f)) {
            WorkspaceMenu(workspaces, vm::switchWorkspace) { vm.navigator.open(Route.Pairing) }
        }
        IconButton(onClick = { vm.syncNow() }, enabled = !vm.syncing) { AwIcon(R.drawable.ic_sync, "Sync now") }
    }
}

/** The height of the bar of the list pane (the height of the app bar). */
private const val LIST_PANE_BAR_DP = 56

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
            // The list pane is 320 dp, as in the approved prototype (openspec phone-desktop-parity).
            directive =
                calculatePaneScaffoldDirectiveWithTwoPanesOnMediumWidth(currentWindowAdaptiveInfoV2())
                    .copy(defaultPanePreferredWidth = LIST_PANE_DP.dp),
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
    // The clock of the relative times of Activity and the lists (openspec phone-desktop-parity).
    CompositionLocalProvider(LocalNowMs provides now) {
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
                    entry<Route.Inbox>(metadata = Route.Inbox.metadata(placeholder)) {
                        InboxScreen(
                            snapshot = snapshot,
                            openCard = (vm.backStack.lastOrNull() as? Route.Card)?.card,
                            onOpen = { vm.navigator.open(Route.Card(it)) },
                            onRun = vm::runInbox,
                        )
                    }
                    // A card of the Inbox, next to the list from medium width (openspec inbox-mattermost).
                    entry<Route.Card>(metadata = Route.Card("").metadata(placeholder)) { route ->
                        val card = snapshot.cards.firstOrNull { it.card == route.card }
                        if (card == null) {
                            EmptyText(NOT_HERE)
                        } else {
                            CardScreen(
                                card = card,
                                snapshot = snapshot,
                                onSet = { read, done, category -> vm.setCard(card.card, read, done, category) },
                                onProject = { vm.setCardProject(card.card, it) },
                                creating = vm.creating,
                                onReply = { vm.replyCard(card.card, it) },
                                onAsk = { vm.askCard(card.card, it) },
                                onCreateTask = { vm.createTaskFromCard(card.card, it) },
                                onOpenTask = vm::openTask,
                            )
                        }
                    }
                    // The item screen of an Inbox row, next to the list from medium width.
                    entry<Route.InboxItem>(metadata = Route.InboxItem("").metadata(placeholder)) { route ->
                        val task = snapshot.task(route.task)
                        if (task == null) {
                            EmptyText(NOT_HERE)
                        } else {
                            InboxItemScreen(
                                task = task,
                                snapshot = snapshot,
                                loadThread = vm::thread,
                                parts = parts,
                                onAnswer = { gate, text, comment, sent ->
                                    vm.answer(task.id, gate, text, comment, sent)
                                },
                                onAssign = { vm.assign(task.id, it) },
                                onOpenTask = { vm.openTask(task.id) },
                            )
                        }
                    }
                    entry<Route.Tasks>(metadata = Route.Tasks.metadata(placeholder)) {
                        // The bar of the list pane while a task shows next to it (the app bar is hidden).
                        val split = vm.backStack.lastOrNull() is Route.Task && vm.widthClass != WidthClass.COMPACT
                        TasksScreen(
                            snapshot = snapshot,
                            updates = InboxItems.updates(peers, now),
                            openTask = openTask,
                            openItem = vm.navigator.openInboxItem,
                            onOpen = vm::openTask,
                            onOpenItem = { vm.navigator.open(Route.InboxItem(it)) },
                            onSyncNow = vm::syncNow,
                            nowMs = now,
                            header = if (split) ({ ListPaneBar(vm) }) else null,
                        ) { vm.navigator.open(Route.NewTask) }
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
                    // A task of the Tasks list: next to the list from medium width, with "Open as page"; on a
                    // compact window the full task page (openspec phone-desktop-parity).
                    entry<Route.Task>(metadata = Route.Task("").metadata(placeholder)) { route ->
                        val inPane = vm.widthClass != WidthClass.COMPACT
                        TaskEntry(vm, snapshot, route.id, parts, if (inPane) vm.navigator::openAsPage else null)
                    }
                    // The task page at the full width: "Open as page", Home, Inbox and a push. No Session pane.
                    entry<Route.TaskPage>(metadata = Route.TaskPage("").metadata(placeholder)) { route ->
                        TaskEntry(vm, snapshot, route.id, parts, null)
                    }
                    entry<Route.NewTask>(metadata = Route.NewTask.metadata(placeholder)) {
                        NewTaskScreen(snapshot, vm.creating, vm::createTask) { vm.back() }
                    }
                    entry<Route.AddCredential>(metadata = Route.AddCredential.metadata(placeholder)) {
                        CredentialScreen(vm.credentialAddAvailable, vm::addCredential) { vm.back() }
                    }
                    entry<Route.Pairing>(metadata = Route.Pairing.metadata(placeholder)) {
                        val pairing by vm.pairing.collectAsStateWithLifecycle()
                        PairingScreen(pairing, vm.joining, vm.storedSlug, vm::join, vm::cancelPairing, vm::message) {
                            vm.back()
                        }
                    }
                },
        )
    }
}

/** The task page of [id] with the actions of the view model; [onOpenAsPage] is set next to the Tasks list. */
@Composable
private fun TaskEntry(
    vm: AppViewModel,
    snapshot: WorkspaceSnapshot,
    id: String,
    parts: TaskDetailParts,
    onOpenAsPage: (() -> Unit)?,
) {
    val task = snapshot.task(id)
    if (task == null) {
        EmptyText(NOT_HERE)
        return
    }
    TaskScreen(
        task = task,
        snapshot = snapshot,
        nav =
            TaskPageNavigation(
                onBack = { vm.back() },
                onOpen = vm::openTask,
                listOn = vm.taskListOn,
                onList = { vm.taskListOn = it },
                onOpenAsPage = onOpenAsPage,
            ),
        loadThread = vm::thread,
        loadTerminal = vm::terminal,
        parts = parts,
        actions =
            TaskPageActions(
                onAnswer = { gate, text, comment, sent -> vm.answer(task.id, gate, text, comment, sent) },
                onAssign = { vm.assign(task.id, it) },
                onSend = { text, sent -> vm.sendMessage(task.id, text, sent) },
                onStopSession = { vm.stopSession(task.id) },
                onNewSession = { assignee, options -> vm.newSession(task.id, assignee, options) },
                onRestart = { vm.restartAgent(task.id) },
                onArchive = { vm.archiveTask(task.id) },
                onUnarchive = { vm.unarchiveTask(task.id) },
            ),
    )
}
