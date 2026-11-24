// Main side of the `call` channel: checks the sender frame and the payload, then calls awd through
// the one `AwClient`. Each result is plain data (`CallResult`), because an Error object loses its
// fields over IPC.
import { AwApiError, AwProtocolError, AwUnreachableError, type AwClient } from "@aw/client";
import type { DesktopClient } from "@aw/client/desktop";
import type { DoctorClient } from "@aw/client/doctor";
import type { IdentityClient } from "@aw/client/identity";
import type { KnowledgeClient } from "@aw/client/knowledge";
import { z } from "zod";
import {
  callRequest,
  type AppSettings,
  type Appearance,
  type CallError,
  type CallRequest,
  type CallResult,
  type ChosenFolder,
  type ConnectionState,
  type FolderPurpose,
} from "../shared/contract.ts";
import { openTaskArtifact } from "./artifacts.ts";
import { OpenFileError, selectWorkspace } from "./files.ts";
import type { CopyPhraseResult, SavePhraseResult } from "./phrase-backup.ts";
import { isSetupCall, runSetupCall, type SetupCallClient } from "./setup-calls.ts";
import { openTerminal, type TerminalLauncher } from "./terminal.ts";

/** The parts of `AwClient` that the calls use. */
export type CallClient = Pick<
  AwClient,
  | "status"
  | "workspaces"
  | "projects"
  | "tasks"
  | "task"
  | "thread"
  | "gates"
  | "sessions"
  | "createTask"
  | "editTask"
  | "assignTask"
  | "archiveTask"
  | "unarchiveTask"
  | "stopTaskSession"
  | "answerGate"
  | "sendMessage"
  | "stopSession"
  | "syncStatus"
  | "syncNow"
  | "issues"
>;

export type IdentityCallClient = Pick<
  IdentityClient,
  | "identity"
  | "phrase"
  | "devices"
  | "revoke"
  | "startPairing"
  | "pairing"
  | "approve"
  | "cancelPairing"
  | "join"
  | "credentials"
  | "addCredential"
  | "removeCredential"
>;

export type KnowledgeCallClient = Pick<
  KnowledgeClient,
  "list" | "read" | "history" | "undo" | "suggestions" | "accept" | "reject" | "digest"
>;

export type DesktopCallClient = Pick<
  DesktopClient,
  "presence" | "sessionHosts" | "taskFiles" | "taskFile" | "restoreDocument" | "queues" | "terminal"
>;

/** The parts of the app and the system that the calls use (Electron in index.ts, fakes in tests). */
export interface HostDeps {
  /** Opens a checked absolute path in the default app; the result is an error text or "". */
  openPath(path: string): Promise<string>;
  /** Gives the absolute path to open for `path` of the workspace folder `root`, or throws. */
  openablePath(root: string, path: string, allowed: readonly string[]): Promise<string>;
  /** Gives the real path of a session folder to open, or throws for a file or a bundle. */
  openableFolder(path: string): Promise<string>;
  /** Shows a checked absolute path in Finder (`shell.showItemInFolder`). */
  showItem(path: string): void;
  settings(): AppSettings;
  setOpenAtLogin(open: boolean): AppSettings;
  /** Stores the Appearance choice and applies it to `nativeTheme.themeSource`. */
  setAppearance(appearance: Appearance): Promise<AppSettings>;
  phraseConfirmed(user: string): Promise<boolean>;
  phraseShown(user: string): Promise<boolean>;
  confirmPhrase(user: string): Promise<void>;
  markPhraseShown(user: string): Promise<void>;
  /** `PhraseBackup.copy` of phrase-backup.ts. */
  copyPhrase(): Promise<CopyPhraseResult>;
  /** `PhraseBackup.save` of phrase-backup.ts. */
  savePhrase(): Promise<SavePhraseResult>;
  /** The native folder dialog (`chooseFolder` of folder-picker.ts). */
  chooseFolder(input: { purpose: FolderPurpose; default_path?: string }): Promise<ChosenFolder>;
}

export interface CallDeps {
  client: CallClient;
  identity: IdentityCallClient;
  knowledge: KnowledgeCallClient;
  desktop: DesktopCallClient;
  setup: SetupCallClient;
  /** The setup check (gap-install). */
  doctor?: Pick<DoctorClient, "doctor">;
  host: HostDeps;
  connection(): ConnectionState;
  openExternal(url: string): Promise<void>;
  /** The programs that "Open the terminal" and "Sign in" start (openspec task-terminal-view). */
  terminal: TerminalLauncher;
}

/** Opens a file of a schema issue ("Fix a file") after the checks of files.ts. */
async function openWorkspaceFile(deps: CallDeps, ws: string, path: string) {
  const workspace = selectWorkspace(await deps.client.workspaces(), ws);
  const issues = await deps.client.issues(ws);
  const allowed = issues.filter((i) => i.code === "bad_document").map((i) => i.path);
  const file = await deps.host.openablePath(workspace.path, path, allowed);
  const error = await deps.host.openPath(file);
  if (error) throw new Error(error);
  return { opened: true };
}

/**
 * Opens the folder of the newest session of a task on this device in Finder (openspec
 * session-options). The renderer names only the task: main reads the folder from awd, so a page
 * can never open another path.
 */
async function openSessionFolder(deps: CallDeps, ws: string, task: string) {
  const workspace = selectWorkspace(await deps.client.workspaces(), ws);
  const session = (await deps.client.sessions())
    .filter((s) => s.task === task && s.workspace === workspace.id)
    .at(-1);
  if (!session) throw new Error("No session of this task ran on this device");
  const folder = await deps.host.openableFolder(session.cwd);
  const error = await deps.host.openPath(folder);
  if (error) throw new Error(error);
  return { opened: true, path: session.cwd };
}

/**
 * True for a frame of the app: `app://aw/...` in a build, or the Vite dev server URL of
 * `electron-vite dev`. Any other frame (a page that the window navigated to, an iframe) is refused.
 */
export function isTrustedSender(frameUrl: string | null | undefined, devServerUrl: string | null) {
  if (!frameUrl) return false;
  if (frameUrl.startsWith("app://aw/")) return true;
  if (devServerUrl === null) return false;
  try {
    return new URL(frameUrl).origin === new URL(devServerUrl).origin;
  } catch {
    return false;
  }
}

/** Maps an error of a call to the plain error of the bridge. */
export function toCallError(error: unknown): CallError {
  if (error instanceof AwApiError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
      ...(error.details === undefined ? {} : { details: error.details }),
    };
  }
  if (error instanceof AwUnreachableError) {
    return { code: "unreachable", message: error.message, status: null };
  }
  if (error instanceof OpenFileError) {
    return { code: "refused", message: error.message, status: null };
  }
  if (error instanceof AwProtocolError) {
    return { code: "protocol", message: error.message, status: null };
  }
  return {
    code: "internal",
    message: error instanceof Error ? error.message : String(error),
    status: null,
  };
}

async function run(request: CallRequest, deps: CallDeps): Promise<unknown> {
  const { client } = deps;
  if (isSetupCall(request)) return runSetupCall(request, deps.setup);
  switch (request.method) {
    case "connection":
      return deps.connection();
    case "status":
      return client.status();
    case "workspaces":
      return client.workspaces();
    case "projects":
      return client.projects(request.args.ws);
    case "tasks":
      return client.tasks(request.args.ws, request.args.query);
    case "task":
      return client.task(request.args.ws, request.args.task);
    case "thread":
      return client.thread(request.args.ws, request.args.task, request.args.query);
    case "gates":
      return client.gates(request.args.ws, request.args.query);
    case "sessions":
      return client.sessions();
    case "createTask":
      return client.createTask(request.args.ws, request.args.body);
    case "editTask":
      return client.editTask(request.args.ws, request.args.task, request.args.body);
    case "assignTask":
      return client.assignTask(
        request.args.ws,
        request.args.task,
        request.args.assignee,
        request.args.session_host,
        request.args.session_options,
      );
    case "archiveTask":
      return client.archiveTask(
        request.args.ws,
        request.args.task,
        request.args.stop === undefined ? {} : { stop: request.args.stop },
      );
    case "unarchiveTask":
      return client.unarchiveTask(request.args.ws, request.args.task);
    case "stopTaskSession":
      return client.stopTaskSession(request.args.ws, request.args.task);
    case "answerGate":
      return client.answerGate(request.args.ws, request.args.gate, request.args.body);
    case "sendMessage":
      return client.sendMessage(request.args.ws, request.args.task, request.args.text);
    case "stopSession":
      return client.stopSession(request.args.session);
    case "openExternal":
      await deps.openExternal(request.args.url);
      return { opened: true };
    // ---- Devices, sync, pairing, credentials ----
    case "syncStatus":
      return client.syncStatus();
    case "syncNow":
      return client.syncNow(request.args);
    case "identity":
      return deps.identity.identity();
    case "phrase":
      return deps.identity.phrase();
    case "devices":
      return deps.identity.devices(request.args.ws);
    case "presence":
      return deps.desktop.presence(request.args.ws);
    case "sessionHosts":
      return deps.desktop.sessionHosts(request.args.ws);
    case "queues":
      return deps.desktop.queues(request.args.ws);
    case "revokeDevice":
      return deps.identity.revoke(request.args.ws, request.args.device);
    case "startPairing":
      return deps.identity.startPairing(request.args.ws);
    case "pairing":
      return deps.identity.pairing(request.args.id);
    case "approvePairing":
      return deps.identity.approve(request.args.id, request.args.check_code);
    case "cancelPairing":
      return deps.identity.cancelPairing(request.args.id);
    case "joinPairing":
      return deps.identity.join({
        code: request.args.code,
        ...(request.args.parent ? { parent: request.args.parent } : {}),
      });
    case "credentials":
      return deps.identity.credentials(request.args.ws);
    case "addCredential":
      return deps.identity.addCredential(request.args.ws, request.args.name, request.args.value);
    case "removeCredential":
      return deps.identity.removeCredential(request.args.ws, request.args.name);
    // ---- Knowledge ----
    case "kbList": {
      const { ws, ...query } = request.args;
      return deps.knowledge.list(ws, query);
    }
    case "kbRead":
      return deps.knowledge.read(request.args.ws, request.args.path, request.args.version);
    case "kbHistory":
      return deps.knowledge.history(request.args.ws, request.args.path);
    case "kbUndo":
      return deps.knowledge.undo(request.args.ws, request.args.change);
    case "kbSuggestions":
      return deps.knowledge.suggestions(request.args.ws, request.args.state);
    case "kbAccept": {
      const { ws, suggestion, ...body } = request.args;
      return deps.knowledge.accept(ws, suggestion, body);
    }
    case "kbReject": {
      const { ws, suggestion, ...body } = request.args;
      return deps.knowledge.reject(ws, suggestion, body);
    }
    case "kbDigest":
      return deps.knowledge.digest(request.args.ws, request.args.date);
    // ---- Files and issues ----
    case "issues":
      return client.issues(request.args.ws);
    case "restoreDocument":
      return deps.desktop.restoreDocument(request.args.ws, request.args.path);
    case "openWorkspaceFile":
      return openWorkspaceFile(deps, request.args.ws, request.args.path);
    case "taskFiles":
      return deps.desktop.taskFiles(request.args.ws, request.args.task);
    case "taskFile":
      return deps.desktop.taskFile(request.args.ws, request.args.task, request.args.path);
    case "openTaskArtifact":
      return openTaskArtifact(
        {
          workspaces: () => deps.client.workspaces(),
          taskFiles: (ws, task) => deps.desktop.taskFiles(ws, task),
          openPath: (path) => deps.host.openPath(path),
          showItem: (path) => deps.host.showItem(path),
        },
        request.args.ws,
        request.args.task,
        request.args.path,
      );
    case "openSessionFolder":
      return openSessionFolder(deps, request.args.ws, request.args.task);
    case "terminal":
      return deps.desktop.terminal(request.args.ws, request.args.task);
    case "openTerminal":
      return openTerminal(
        deps.desktop,
        deps.terminal,
        request.args.ws,
        request.args.task,
        request.args.action,
      );
    // ---- App ----
    case "phraseConfirmed":
      return {
        confirmed: await deps.host.phraseConfirmed(request.args.user),
        shown: await deps.host.phraseShown(request.args.user),
      };
    case "phraseShown":
      await deps.host.markPhraseShown(request.args.user);
      return { shown: true };
    case "confirmPhrase":
      await deps.host.confirmPhrase(request.args.user);
      return { confirmed: true };
    case "copyPhrase":
      return deps.host.copyPhrase();
    case "savePhrase":
      return deps.host.savePhrase();
    case "appSettings":
      return deps.host.settings();
    case "setOpenAtLogin":
      return deps.host.setOpenAtLogin(request.args.open);
    case "setAppearance":
      return deps.host.setAppearance(request.args.appearance);
    case "chooseFolder":
      return deps.host.chooseFolder(request.args);
    // ---- Setup check ----
    case "doctor":
      if (!deps.doctor) throw new Error("The setup check is not available");
      return deps.doctor.doctor();
  }
}

/** Parses one payload of the `call` channel and runs it. It never throws. */
export async function dispatchCall(payload: unknown, deps: CallDeps): Promise<CallResult<unknown>> {
  const parsed = callRequest.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "invalid_input",
        message: `The call does not match the bridge contract: ${z.prettifyError(parsed.error)}`,
        status: null,
      },
    };
  }
  try {
    return { ok: true, value: await run(parsed.data, deps) };
  } catch (error) {
    return { ok: false, error: toCallError(error) };
  }
}

/** The reply to a call from a frame that is not the app. */
export const refusedSender: CallResult<never> = {
  ok: false,
  error: { code: "refused", message: "The call does not come from the app window", status: null },
};
