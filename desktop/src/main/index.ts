// The Electron main process: the window, the `app://` protocol, the one awd connection, the `call`
// channel, and the background parts: notifications, the menu bar Tray, Sync before sleep and the
// login item (docs/architecture.md 4.10, 6.3; docs/tech-stack.md 1.4; docs/phase-1.md 6.4, 10).
import { AwClient } from "@aw/client";
import { DesktopClient } from "@aw/client/desktop";
import { DoctorClient } from "@aw/client/doctor";
import { IdentityClient } from "@aw/client/identity";
import { KnowledgeClient } from "@aw/client/knowledge";
import { SetupClient } from "@aw/client/setup";
import { systemClock } from "@aw/core/clock";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  powerMonitor,
  protocol,
  shell,
  Tray,
  type MenuItemConstructorOptions,
} from "electron";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { pino } from "pino";
import {
  CHANNELS,
  type AppCommand,
  type Appearance,
  type AppSettings,
  type LoginItemState,
} from "../shared/channels.ts";
import { loadBackground, type BackgroundLoad } from "./background-load.ts";
import { BackgroundRefresh } from "./background.ts";
import { dispatchCall, isTrustedSender, refusedSender, type HostDeps } from "./calls.ts";
import { CommandQueue } from "./commands.ts";
import { AwConnection } from "./connection.ts";
import { openableFolder, openablePath } from "./files.ts";
import { chooseFolder } from "./folder-picker.ts";
import {
  NotificationCenter,
  type DeliveredNotification,
  type NotificationFactory,
  type NotificationHandlers,
} from "./notifications.ts";
import { PhraseBackup } from "./phrase-backup.ts";
import { DesktopPrefs } from "./prefs.ts";
import { APP_HOST, APP_SCHEME, APP_URL, serveApp } from "./protocol.ts";
import { loadSettings } from "./settings.ts";
import { macLauncher } from "./terminal.ts";
import {
  countNeedsYou,
  countsAfterError,
  TRAY_ICON_PNG_BASE64,
  trayModel,
  type TrayCounts,
} from "./tray.ts";
import { followScheme, windowOptions } from "./window.ts";

const settings = loadSettings({ packaged: app.isPackaged });
const log = pino(
  { name: "aw-desktop", level: settings.logLevel, redact: ["token", "secret", "key", "cookie"] },
  pino.destination(2),
);
const rendererRoot = fileURLToPath(new URL("../renderer", import.meta.url));
const preloadPath = fileURLToPath(new URL("../preload/index.cjs", import.meta.url));

protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const client = new AwClient({ socketPath: settings.socketPath });
const identity = new IdentityClient(client);
const knowledge = new KnowledgeClient(client);
const desktop = new DesktopClient(client);
const setup = new SetupClient(client);
const doctor = new DoctorClient(client);
let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let prefs: DesktopPrefs | null = null;
/** Copy and save of the recovery phrase (openspec keys-backup). */
const phraseBackup = new PhraseBackup({
  phrase: async () => (await identity.phrase()).phrase,
  identity: () => identity.identity(),
  clipboard: {
    readText: () => clipboard.readText(),
    writeText: (text) => clipboard.writeText(text),
    clear: () => clipboard.clear(),
  },
  clock: systemClock,
  onError: (error) => log.warn({ err: error }, "the clear of the copied recovery phrase failed"),
  home: app.getPath("home"),
  chooseFile: async (defaultPath) => {
    const options: Electron.SaveDialogOptions = {
      title: "Save the recovery phrase",
      defaultPath,
      buttonLabel: "Save",
      message:
        "Anyone with this file can add devices to your workspaces. Keep it out of synced folders such as iCloud Drive.",
      filters: [{ name: "Text", extensions: ["txt"] }],
      properties: ["createDirectory", "showOverwriteConfirmation"],
    };
    const result =
      window && !window.isDestroyed()
        ? await dialog.showSaveDialog(window, options)
        : await dialog.showSaveDialog(options);
    return result.canceled || !result.filePath ? null : result.filePath;
  },
});
/** The commands for the renderer: a command waits until the renderer of the window listens. */
const commands = new CommandQueue((next) => send(CHANNELS.command, next));
let counts: TrayCounts = { needsYou: null, unsynced: null, online: false };

function send(channel: string, payload?: unknown): void {
  if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
}

function openExternal(url: string): Promise<void> {
  if (!url.startsWith("https://")) return Promise.resolve();
  return shell.openExternal(url);
}

/** Shows the window (makes it again when it was closed) and focuses it. */
function showWindow(): void {
  if (!window || window.isDestroyed()) window = createWindow();
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

/** Sends a command to the renderer; a command of the Tray or a notification shows the window. */
function command(name: AppCommand, show = false): void {
  if (show) showWindow();
  commands.send(name);
}

// ---- Login item ----

function loginItem(): LoginItemState {
  if (process.platform !== "darwin" && process.platform !== "win32") {
    return { supported: false, open: false, status: null };
  }
  const state = app.getLoginItemSettings();
  return {
    supported: true,
    open: state.openAtLogin,
    status: (state as { status?: string }).status ?? null,
  };
}

/** The error of the last notification that macOS did not show. */
let notificationError: string | null = null;

/** The Appearance choice of Settings; main reads it from the prefs before the first window. */
let appearance: Appearance = "system";

/** The text size of a proposal; main reads it from the prefs at the start. */
let proposalTextPx = 16;

function appSettings(): AppSettings {
  return {
    appearance,
    proposal_text_px: proposalTextPx,
    login: loginItem(),
    notifications: Notification.isSupported(),
    notification_error: notificationError,
  };
}

// ---- Notifications ----

function attachHandlers(n: Notification, handlers: NotificationHandlers): void {
  n.on("click", () => handlers.click());
  n.on("action", (event) => handlers.action(event.actionIndex));
  n.on("reply", (event) => handlers.reply(event.reply));
  n.on("failed", (_event, error) => {
    log.warn({ error }, "a notification failed");
    notificationError = String(error);
  });
}

/** The Electron `Notification`; the app keeps each object so that its handlers stay attached. */
const electronNotifications: NotificationFactory = {
  supported: () => Notification.isSupported(),
  show: (spec, handlers) => {
    const n = new Notification({
      id: spec.id,
      groupId: spec.groupId,
      title: spec.title,
      body: spec.body,
      hasReply: spec.hasReply,
      replyPlaceholder: spec.hasReply ? "Reply" : undefined,
      actions: spec.actions.map((text) => ({ type: "button" as const, text })),
    });
    attachHandlers(n, handlers);
    n.show();
    return { close: () => n.close() };
  },
  history: async () => {
    if (process.platform !== "darwin") return [];
    const delivered = await Notification.getHistory();
    return delivered.map((n): DeliveredNotification => ({
      id: n.id,
      attach: (handlers) => attachHandlers(n, handlers),
      close: () => n.close(),
    }));
  },
};

const notifications = new NotificationCenter({
  factory: electronNotifications,
  answer: (ws, gate, body) => client.answerGate(ws, gate, body),
  open: (target) => command({ open: "task", ws: target.ws, task: target.task }, true),
  onError: (error) => log.warn({ err: error }, "a notification action failed"),
});

// ---- Tray ----

function updateTray(): void {
  if (!tray) return;
  const model = trayModel(counts);
  tray.setTitle(model.title);
  tray.setToolTip(model.tooltip);
  const template: MenuItemConstructorOptions[] = model.items.map((item) => {
    if (item.type === "separator") return { type: "separator" };
    if (item.type === "text") return { label: item.label, enabled: false };
    const click =
      item.action === "sync-now"
        ? () => command("sync-now", true)
        : item.action === "open"
          ? () => showWindow()
          : () => app.quit();
    return { label: item.label, accelerator: item.accelerator, click };
  });
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function createTray(): void {
  const icon = nativeImage.createFromBuffer(Buffer.from(TRAY_ICON_PNG_BASE64, "base64"), {
    scaleFactor: 2,
  });
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  updateTray();
}

// ---- Background refresh: notifications and Tray counts ----

/** The last background load: a workspace that is not ready for one load keeps its tasks. */
let lastLoad: BackgroundLoad | null = null;
const background = new BackgroundRefresh({
  clock: systemClock,
  load: () => loadBackground(client, lastLoad),
  onLoaded: (load) => {
    lastLoad = load;
    const { lists, unsynced, complete } = load;
    notifications.update(lists, { complete });
    counts = { needsYou: countNeedsYou(lists), unsynced, online: true };
    updateTray();
  },
  onError: (error) => {
    log.debug({ err: error }, "the background refresh failed");
    counts = countsAfterError(counts, error);
    updateTray();
  },
});

const connection = new AwConnection({
  client,
  clock: systemClock,
  onState: (state) => {
    if (state.state === "offline") {
      log.warn({ reason: state.reason }, "awd connection offline");
      counts = { ...counts, online: false };
      updateTray();
    }
    send(CHANNELS.connection, state);
  },
  onEvent: (message) => {
    send(CHANNELS.event, message);
    if (message.type === "changed") background.schedule();
  },
  onResync: () => {
    send(CHANNELS.resync);
    background.schedule();
  },
});

/** The app menu. It has no `reload` or `forceReload` role: "Sync now" owns CmdOrCtrl+R. */
function buildMenu(): Menu {
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
    {
      label: "File",
      submenu: [
        { label: "New Task", accelerator: "CmdOrCtrl+N", click: () => command("new-task") },
        { label: "New Session", click: () => command("new-session") },
        { type: "separator" },
        { label: "Sync now", accelerator: "CmdOrCtrl+R", click: () => command("sync-now", true) },
        { type: "separator" },
        { role: "close" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        ...(settings.devServerUrl ? [{ role: "toggleDevTools" as const }] : []),
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ];
  return Menu.buildFromTemplate(template);
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow(
    windowOptions({
      platform: process.platform,
      dark: nativeTheme.shouldUseDarkColors,
      preload: preloadPath,
    }),
  );
  followScheme(win, nativeTheme);
  win.once("ready-to-show", () => win.show());
  commands.reset();
  win.webContents.on("did-start-loading", () => {
    if (window === win) commands.reset();
  });
  win.on("closed", () => {
    if (window !== win) return;
    window = null;
    commands.reset();
  });
  void win.loadURL(settings.devServerUrl ?? APP_URL);
  return win;
}

app.on("web-contents-created", (_event, contents) => {
  // No new windows: an https link opens in the default browser.
  contents.setWindowOpenHandler(({ url }) => {
    void openExternal(url);
    return { action: "deny" };
  });
  // No navigation away from the app.
  contents.on("will-navigate", (event, url) => {
    if (!isTrustedSender(url, settings.devServerUrl)) event.preventDefault();
  });
  contents.on("will-attach-webview", (event) => event.preventDefault());
});

void app.whenReady().then(async () => {
  protocol.handle(APP_SCHEME, (request) => serveApp(rendererRoot, request.url));
  prefs = new DesktopPrefs(join(app.getPath("userData"), "aw-desktop.json"));
  // Read the Appearance before the Tray, the notifications or a call can open a window.
  appearance = await prefs.appearance();
  nativeTheme.themeSource = appearance;
  proposalTextPx = await prefs.proposalTextPx();
  const host: HostDeps = {
    openPath: (path) => shell.openPath(path),
    showItem: (path) => shell.showItemInFolder(path),
    openablePath,
    openableFolder,
    settings: appSettings,
    setOpenAtLogin: (open) => {
      if (loginItem().supported) app.setLoginItemSettings({ openAtLogin: open });
      return appSettings();
    },
    setAppearance: async (choice) => {
      await prefs!.setAppearance(choice);
      appearance = choice;
      // The renderer (prefers-color-scheme), the window background (followScheme) and the menus
      // follow the theme source.
      nativeTheme.themeSource = choice;
      return appSettings();
    },
    setProposalTextSize: async (px) => {
      await prefs!.setProposalTextPx(px);
      proposalTextPx = px;
      return appSettings();
    },
    phraseConfirmed: (user) => prefs!.phraseConfirmed(user),
    phraseShown: (user) => prefs!.phraseShown(user),
    confirmPhrase: (user) => prefs!.confirmPhrase(user),
    markPhraseShown: (user) => prefs!.markPhraseShown(user),
    copyPhrase: () => phraseBackup.copy(),
    savePhrase: () => phraseBackup.save(),
    chooseFolder: (input) =>
      chooseFolder(
        {
          home: app.getPath("home"),
          showOpenDialog: (options) =>
            window && !window.isDestroyed()
              ? dialog.showOpenDialog(window, options)
              : dialog.showOpenDialog(options),
        },
        input,
      ),
  };
  ipcMain.handle(CHANNELS.call, (event, payload: unknown) => {
    if (!isTrustedSender(event.senderFrame?.url, settings.devServerUrl)) {
      log.warn({ frame: event.senderFrame?.url }, "refused a call from another frame");
      return refusedSender;
    }
    return dispatchCall(payload, {
      client,
      identity,
      knowledge,
      desktop,
      setup,
      doctor,
      host,
      connection: () => connection.state,
      openExternal,
      terminal: macLauncher(),
    });
  });
  ipcMain.on(CHANNELS.commandReady, (event) => {
    if (!isTrustedSender(event.senderFrame?.url, settings.devServerUrl)) return;
    if (window && !window.isDestroyed() && event.sender === window.webContents) commands.ready();
  });
  Menu.setApplicationMenu(buildMenu());
  createTray();
  // The first load attaches the handlers to the delivered notifications of the last run: read them
  // before the first load can start (devices-kb review 9).
  void notifications.start().finally(() => {
    connection.start();
    void background.every();
  });
  // Sync before sleep (docs/phase-1.md 6.4): best effort, 5 s.
  powerMonitor.on("suspend", () => {
    client.syncNow({ timeout_ms: 5000 }).catch((error: unknown) => {
      log.warn({ err: error }, "Sync before sleep failed");
    });
  });
  window = createWindow();
  log.info({ socket: settings.socketPath, host: APP_HOST }, "desktop app started");

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) window = createWindow();
  });
});

app.on("window-all-closed", () => {
  // The app stays in the menu bar with no window (docs/phase-1.md 10.6). "Quit" in the Tray ends it.
});

app.on("before-quit", () => {
  // The recovery phrase leaves the clipboard with the app (openspec keys-backup). The clear is
  // synchronous: a stopped quit can cancel a macOS logout or shutdown.
  phraseBackup.clearAtQuit();
  background.stop();
  void connection.stop();
});
