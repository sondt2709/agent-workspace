// The aw CLI (docs/workflow.md 8, design decision 19). It parses the arguments, calls the local
// API through @aw/client and prints the reply. Exit codes: 0 ok, 1 refused or gate open, 2 invalid
// input, 3 awd not reachable (docs/engineering-rules.md 5.17).
import {
  AwApiError,
  AwClient,
  AwProtocolError,
  AwUnreachableError,
  type CreateTaskInput,
  type EditTaskInput,
  type SessionOptionsInput,
  type WriteResult,
} from "@aw/client";
import { Command, CommanderError, Option } from "@commander-js/extra-typings";
import { execa } from "execa";
import { readFile, realpath } from "node:fs/promises";
import { userInfo } from "node:os";
import { resolve, sep } from "node:path";
import type { DoctorProbes } from "../service/doctor.ts";
import { loadSettings, type Environment, type Settings } from "../settings.ts";
import type { CommandRunner } from "../units/units.ts";
import { AW_VERSION } from "../version.ts";
import { addAgentCommands } from "./agent.ts";
import { addDoctorCommand } from "./doctor.ts";
import {
  formatGate,
  formatGates,
  formatProjects,
  formatStatus,
  formatTask,
  formatTasks,
  formatThread,
  formatWorkspaces,
} from "./format.ts";
import { addIdentityCommands } from "./identity.ts";
import { addKnowledgeCommands } from "./kb.ts";
import { withPause } from "./pause.ts";
import { HUMAN_COMMANDS } from "./person-commands.ts";
import { addQueueCommand } from "./queue.ts";
import { addServiceCommands, type ServiceDeps } from "./service.ts";
import { addSetupCommands } from "./setup.ts";
import { addSyncCommands } from "./sync.ts";
import { addTerminalCommand } from "./terminal.ts";

export const EXIT = { ok: 0, refused: 1, invalid: 2, unreachable: 3 } as const;

export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
  /** The environment. Default `process.env`. Only the settings module reads it. */
  env?: Environment;
  /** The folder for relative paths. Default `process.cwd()`. */
  cwd?: string;
  /** Reads stdin for `--first-message-file -`. */
  stdin?: () => Promise<string>;
}

export interface CliDeps {
  /** Runs `systemctl`, `launchctl` and `dscl`. Tests give a fake runner. */
  runner?: CommandRunner;
  platform?: NodeJS.Platform;
  /** The user id of this process. Default `process.getuid()`. Tests give 0 for root. */
  uid?: number;
  /** The engine install of `aw engine install` and `aw service install`; tests give a fake. */
  engine?: ServiceDeps["engine"];
  /** The keystores of `aw service move-keys`; tests give file keystores. */
  keystores?: ServiceDeps["keystores"];
  /** The tmux search of `aw service install`; tests give a fake. */
  findTmux?: ServiceDeps["findTmux"];
  /** The probes of the local `aw doctor` (awd not running); tests give fakes. */
  doctorProbes?: DoctorProbes;
}

/** An input error that the CLI finds before it calls awd. */
class InputError extends Error {}

/** `--permission-mode` of `aw task create|assign` (openspec session-options). */
function permissionModeOption() {
  return new Option(
    "--permission-mode <mode>",
    "the permission mode of the sessions: skip runs each command with no gate",
  ).choices(["default", "accept_edits", "skip"] as const);
}

/** `--work-in` of `aw task create|assign` (openspec session-options). */
function workInOption() {
  return new Option("--work-in <where>", "where the session works (default worktree)").choices([
    "worktree",
    "checkout",
    "folder",
  ] as const);
}

/** The session options of the flags, or null when no flag is given. */
function sessionOptionsOf(options: {
  permissionMode?: "default" | "accept_edits" | "skip";
  agentTeams?: true;
  workIn?: "worktree" | "checkout" | "folder";
  folder?: string;
  keepBranch?: true;
}): SessionOptionsInput | null {
  if (
    options.permissionMode === undefined &&
    options.agentTeams === undefined &&
    options.workIn === undefined &&
    options.folder === undefined &&
    options.keepBranch === undefined
  ) {
    return null;
  }
  // The folder is a path of the session device, maybe another computer: the CLI does not resolve
  // it, and awd refuses a relative path.
  const folder = options.folder;
  return {
    ...(options.permissionMode ? { permission_mode: options.permissionMode } : {}),
    ...(options.agentTeams ? { agent_teams: true } : {}),
    ...(options.workIn
      ? { work_in: options.workIn }
      : folder
        ? { work_in: "folder" as const }
        : {}),
    ...(folder ? { folder } : {}),
    ...(options.keepBranch ? { switch_branch: false } : {}),
  };
}

/** A command that the CLI refuses before it calls awd (exit code 1). */
class RefusedError extends Error {}

function commandPath(command: { name(): string; parent: unknown }): string {
  const names: string[] = [];
  let current: { name(): string; parent: unknown } | null = command;
  while (current?.parent) {
    names.unshift(current.name());
    current = current.parent as { name(): string; parent: unknown } | null;
  }
  return names.join(" ");
}

const defaultRunner: CommandRunner = async (file, args) => {
  const result = await execa(file, args, { reject: false, timeout: 30_000 });
  return {
    exitCode: result.exitCode ?? 1,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
};

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

/** Runs the aw CLI and returns the exit code. It writes only to `io`. */
export async function run(argv: string[], io: CliIo, deps: CliDeps = {}): Promise<number> {
  let settings: Settings;
  try {
    settings = loadSettings(io.env ?? process.env);
  } catch (error) {
    io.stderr(`aw: ${(error as Error).message}\n`);
    return EXIT.invalid;
  }
  // Inside a session, the CLI sends the session token (AW_MCP_TOKEN): awd treats each call as the
  // agent of the session, and refuses the person routes (add-mcp-server).
  const client = new AwClient({
    socketPath: settings.socketPath,
    token: settings.sessions.token,
  });
  const cwd = io.cwd ?? process.cwd();
  let exitCode: number = EXIT.ok;

  const program = new Command("aw")
    .description("Agent Workspace: manage the work of AI coding agents. Talks to the local awd.")
    .version(AW_VERSION, "-V, --version")
    .option("--json", "write the result as JSON to stdout")
    .option("-w, --workspace <name-or-id>", "the workspace (default: the only workspace)")
    .exitOverride()
    .configureOutput({
      writeOut: (text) => io.stdout(text),
      writeErr: (text) => io.stderr(text),
    })
    .hook("preAction", (_program, action) => {
      const path = commandPath(action);
      if (settings.sessions.session !== null && HUMAN_COMMANDS.has(path)) {
        throw new RefusedError(
          `aw ${path} is a command of a person, and this is an agent session (AW_SESSION is set). Ask the human with aw ask.`,
        );
      }
    });

  const globals = () => program.opts();
  const wsName = () => globals().workspace ?? "-";
  const print = (value: unknown, text: () => string) => {
    io.stdout(globals().json ? `${JSON.stringify(value, null, 2)}\n` : `${text()}\n`);
  };
  /**
   * Prints a write reply. A write that the merge did not apply, or a gate answer that the merge
   * made a comment (the gate is unknown, the version is old, or the gate is resolved), gives exit
   * code 1 and the reason (principle 9): the gate still waits.
   */
  const printWrite = (reply: unknown, results: WriteResult[], text: () => string) => {
    print(reply, text);
    for (const result of results) {
      if (!result.applied) {
        io.stderr(
          `aw: awd wrote ${result.event.type} ${result.event.id}, but the merge did not apply it: ${result.reason ?? "unknown reason"}\n`,
        );
        exitCode = EXIT.refused;
      } else if (result.event.type === "gate.answered" && result.reason !== null) {
        io.stderr(
          `aw: awd wrote the answer ${result.event.id}, but it does not count: the merge made it a comment (${result.reason}). The gate still waits for an answer.\n`,
        );
        exitCode = EXIT.refused;
      }
    }
  };
  /**
   * In an agent session, a file must be in the working folder of the session after each symlink,
   * as for `aw result` and `aw artifact add`: the allow rules of `aw approach`, `aw gate open`,
   * `aw kb write`, `aw learn` and `aw task create` skip the permission prompt that a read outside
   * that folder needs, and the text syncs to each device (fix list 0-3).
   */
  const checkSessionFile = async (path: string) => {
    const id = settings.sessions.session?.id;
    if (!id) return;
    const record = (await client.sessions()).find((s) => s.id === id);
    if (!record) {
      throw new RefusedError(`Session ${id} does not run on this device: AW reads no file for it.`);
    }
    let real: string;
    let root: string;
    try {
      real = await realpath(path);
      root = await realpath(record.cwd);
    } catch (error) {
      throw new InputError(
        `Cannot read ${path}: ${(error as NodeJS.ErrnoException).code ?? (error as Error).message}`,
      );
    }
    if (real !== root && !real.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)) {
      throw new RefusedError(
        `${path} is not in the working folder of the session (${record.cwd}). AW sends only a file of that folder to the devices of the workspace.`,
      );
    }
  };
  const readText = async (path: string) => {
    if (path === "-") {
      if (!io.stdin) throw new InputError("stdin is not available");
      return io.stdin();
    }
    await checkSessionFile(resolve(cwd, path));
    try {
      return await readFile(resolve(cwd, path), "utf8");
    } catch (error) {
      throw new InputError(
        `Cannot read ${path}: ${(error as NodeJS.ErrnoException).code ?? (error as Error).message}`,
      );
    }
  };

  program
    .command("status")
    .description("Show awd, this device and the workspaces")
    .action(async () => {
      const status = await client.status();
      print(status, () => formatStatus(status));
    });

  // ---- workspace ----
  const workspace = program.command("workspace").description("Workspace folders");
  workspace
    .command("init")
    .description(
      "Create a workspace folder, or register a folder that another device synced. With no path: <location>/<name> (location ~/AW, name Personal by default), or <name>-aw1 when that name is in use.",
    )
    .argument("[path]", "the workspace folder itself, for example ~/AW/acme")
    .option(
      "--in <folder>",
      "the folder that holds the workspace folder; it can hold other files (default ~/AW)",
    )
    .option("--name <name>", "the name of a new workspace")
    .option("--key-prefix <prefix>", "the task key prefix of a new workspace", "AW")
    .action(async (path, options) => {
      if (path !== undefined && options.in) {
        throw new InputError("Give a path or --in, not both");
      }
      const reply = await client.initWorkspace({
        ...(path === undefined ? {} : { path: resolve(cwd, path) }),
        ...(options.in ? { parent: resolve(cwd, options.in) } : {}),
        ...(options.name ? { name: options.name } : {}),
        key_prefix: options.keyPrefix,
      });
      print(
        reply,
        () =>
          `${reply.created ? "Created" : "Registered"} workspace ${reply.workspace.name ?? "-"} (${reply.workspace.id}) at ${reply.workspace.path}${reply.folder_note ? `\n${reply.folder_note}` : ""}`,
      );
    });
  workspace
    .command("list")
    .description("List the workspaces of this device")
    .action(async () => {
      const list = await client.workspaces();
      print(list, () => formatWorkspaces(list));
    });

  // ---- project ----
  const project = program.command("project").description("Projects of a workspace");
  project
    .command("add")
    .description("Add a project")
    .argument("<slug>", "the project slug, for example billing-api")
    .option("--name <name>", "the display name")
    .option("--device <slug>", "an implementing device, in order (repeat)", collect)
    .option("--default-agent <agent>", "the agent of new tasks", "claude")
    .addOption(
      new Option(
        "--permission-mode <mode>",
        "the permission mode of new sessions (default: the workspace setting for new projects)",
      ).choices(["default", "accept_edits", "skip"] as const),
    )
    .action(async (slug, options) => {
      const reply = await client.addProject(wsName(), {
        slug,
        ...(options.name ? { name: options.name } : {}),
        ...(options.device ? { devices: options.device } : {}),
        default_agent: options.defaultAgent,
        ...(options.permissionMode ? { permission_mode: options.permissionMode } : {}),
      });
      print(reply, () => `Added project ${reply.slug}`);
    });
  project
    .command("list")
    .description("List the projects")
    .action(async () => {
      const list = await client.projects(wsName());
      print(list, () => formatProjects(list));
    });

  // ---- task ----
  const task = program.command("task").description("Tasks");
  task
    .command("create")
    .description(
      "Create a task with its first message. In an AW session: a subtask of the session task",
    )
    .option("--project <slug>", "the project (in a session: the project of the parent)")
    .requiredOption("--title <title>", "the title")
    .option("--first-message-file <path>", "a file with the first message; - reads stdin")
    .option("--first-message <text>", "the first message as text")
    .option("--assignee <agent@device>", "for example claude@ubuntu-01")
    .option("--parent <task>", "the parent task (key or id)")
    .option("--depends-on <task>", "a task that must be done first (repeat)", collect)
    .option("--test-server <name>", "a name in secure/test-servers.yaml")
    .option("--credential <name>", "a credential name (repeat)", collect)
    .option("--link <link>", "a link, for example github:acme/billing-api#412 (repeat)", collect)
    .option("--from-parent", "in a session: copy the test server, credentials and links")
    .addOption(
      new Option("--host <host>", "the session host of the session").choices(["tmux", "orca"]),
    )
    .addOption(permissionModeOption())
    .option("--agent-teams", "turn on Claude Code agent teams")
    .addOption(workInOption())
    .option("--folder <path>", "the folder of --work-in folder (an absolute path on the device)")
    .option("--keep-branch", "with --work-in checkout: keep the branch of the checkout")
    .action(async (options) => {
      if ((options.firstMessageFile === undefined) === (options.firstMessage === undefined)) {
        throw new InputError(
          "Give the first message with --first-message-file or --first-message (one of them)",
        );
      }
      const session = settings.sessions.session?.id;
      if (session) {
        // An agent creates a subtask of its session task (docs/workflow.md 4.6).
        if (options.assignee) {
          throw new RefusedError(
            "An agent does not assign a task: the human assigns it (or the project switch). Leave out --assignee.",
          );
        }
        if (options.host) {
          throw new RefusedError(
            "An agent does not choose the session host: the human or the device does. Leave out --host.",
          );
        }
        if (sessionOptionsOf(options) !== null) {
          throw new RefusedError(
            "An agent does not set the session options: only a person does. Leave out --permission-mode, --agent-teams, --work-in, --folder and --keep-branch.",
          );
        }
        const reply = await client.createSubtask(session, {
          title: options.title,
          first_message: options.firstMessage ?? (await readText(options.firstMessageFile!)),
          ...(options.project ? { project: options.project } : {}),
          ...(options.parent ? { parent: options.parent } : {}),
          ...(options.dependsOn ? { depends_on: options.dependsOn } : {}),
          ...(options.fromParent ? { from_parent: true } : {}),
          ...(options.testServer ? { test_server: options.testServer } : {}),
          ...(options.credential ? { credentials: options.credential } : {}),
          ...(options.link ? { links: options.link } : {}),
        });
        print(reply, () => reply.next);
        return;
      }
      if (!options.project) throw new InputError("Give the project with --project <slug>");
      if (options.fromParent) throw new InputError("--from-parent works only in an AW session");
      const body: CreateTaskInput = {
        project: options.project,
        title: options.title,
        first_message: options.firstMessage ?? (await readText(options.firstMessageFile!)),
        ...(options.assignee ? { assignee: options.assignee } : {}),
        ...(options.parent ? { parent: options.parent } : {}),
        ...(options.dependsOn ? { depends_on: options.dependsOn } : {}),
        ...(options.testServer ? { test_server: options.testServer } : {}),
        ...(options.credential ? { credentials: options.credential } : {}),
        ...(options.link ? { links: options.link } : {}),
        ...(options.host ? { session_host: options.host } : {}),
      };
      const sessionOptions = sessionOptionsOf(options);
      if (sessionOptions !== null) body.session_options = sessionOptions;
      const reply = await client.createTask(wsName(), body);
      printWrite(reply, [reply], () => {
        const lane = reply.task.needs_you_lane ? " (needs you: assign)" : "";
        return `Created ${reply.task.key ?? reply.task.id} ${reply.task.id}${lane}`;
      });
    });
  task
    .command("list")
    .description("List the tasks (archived tasks only with --all or --archived)")
    .option("--project <slug>", "only this project")
    .addOption(
      new Option("--stage <stage>", "only this stage").choices([
        "backlog",
        "discuss",
        "ready",
        "implement",
        "review",
        "done",
      ] as const),
    )
    .option("--needs-you", "only the tasks in the Needs you lane")
    .option("--archived", "only the archived tasks")
    .option("--all", "also the archived tasks")
    .action(async (options) => {
      const found = await client.tasks(wsName(), {
        ...(options.project ? { project: options.project } : {}),
        ...(options.stage ? { stage: options.stage } : {}),
        ...(options.needsYou ? { needs_you: "true" as const } : {}),
        ...(options.archived
          ? { archived: "true" as const }
          : options.all
            ? {}
            : { archived: "false" as const }),
      });
      const list = await withPause(client, wsName(), found);
      print(list, () => formatTasks(list));
    });
  task
    .command("show")
    .description("Show one task")
    .argument("<task>", "the key or the id")
    .action(async (ref) => {
      const [reply] = await withPause(client, wsName(), [await client.task(wsName(), ref)]);
      print(reply!, () => formatTask(reply!));
    });
  task
    .command("edit")
    .description("Edit the title, the first message or the priority")
    .argument("<task>", "the key or the id")
    .option("--title <title>")
    .option("--first-message-file <path>", "- reads stdin")
    .option("--first-message <text>")
    .option("--priority <priority>")
    .action(async (ref, options) => {
      if (options.firstMessage !== undefined && options.firstMessageFile !== undefined) {
        throw new InputError("Give --first-message-file or --first-message, not both");
      }
      const body: EditTaskInput = {
        ...(options.title !== undefined ? { title: options.title } : {}),
        ...(options.priority !== undefined ? { priority: options.priority } : {}),
      };
      const message =
        options.firstMessage ??
        (options.firstMessageFile !== undefined
          ? await readText(options.firstMessageFile)
          : undefined);
      if (message !== undefined) body.first_message = message;
      if (Object.keys(body).length === 0) {
        throw new InputError("Give --title, --first-message(-file) or --priority");
      }
      const reply = await client.editTask(wsName(), ref, body);
      printWrite(reply, reply.results, () => `Edited ${reply.task.key ?? reply.task.id}`);
    });
  task
    .command("assign")
    .description("Assign the task to an agent on a device")
    .argument("<task>", "the key or the id")
    .argument("<assignee>", "agent@device, for example claude@ubuntu-01")
    .addOption(
      new Option("--host <host>", "the session host of the new session").choices(["tmux", "orca"]),
    )
    .addOption(permissionModeOption())
    .option("--agent-teams", "turn on Claude Code agent teams")
    .addOption(workInOption())
    .option("--folder <path>", "the folder of --work-in folder (an absolute path on the device)")
    .option("--keep-branch", "with --work-in checkout: keep the branch of the checkout")
    .action(async (ref, assignee, options) => {
      const reply = await client.assignTask(
        wsName(),
        ref,
        assignee,
        options.host,
        sessionOptionsOf(options) ?? undefined,
      );
      printWrite(
        reply,
        [reply],
        () => `Assigned ${reply.task.key ?? reply.task.id} to ${assignee}`,
      );
    });
  task
    .command("archive")
    .description("Archive the task. A running session needs --stop.")
    .argument("<task>", "the key or the id")
    .option("--stop", "stop a running session of the task first, on any device")
    .action(async (ref, options: { stop?: boolean }) => {
      const reply = await client.archiveTask(wsName(), ref, options.stop ? { stop: true } : {});
      printWrite(reply, [reply], () => `Archived ${reply.task.key ?? reply.task.id}`);
    });
  task
    .command("unarchive")
    .description("Make an archived task active again. AW starts no session until you start one.")
    .argument("<task>", "the key or the id")
    .action(async (ref) => {
      const reply = await client.unarchiveTask(wsName(), ref);
      printWrite(reply, [reply], () => `Unarchived ${reply.task.key ?? reply.task.id}`);
    });
  task
    .command("stop")
    .description("Stop the running session of the task, on any device")
    .argument("<task>", "the key or the id")
    .action(async (ref) => {
      const reply = await client.stopTaskSession(wsName(), ref);
      printWrite(
        reply,
        [reply],
        () =>
          `Stop requested for the session of ${reply.task.key ?? reply.task.id}. Its device stops it. AW starts no new session until a person starts one.`,
      );
    });

  // ---- thread ----
  program
    .command("thread")
    .description("Print the original thread of a task: each message, gate and answer, as written")
    .argument("<task>", "the key or the id")
    .option("--after <cursor>", "start after this cursor (the next cursor of the last page)")
    .option("--limit <n>", "events per page (1 to 1000)", (value) => {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > 1000)
        throw new InputError("--limit must be 1 to 1000");
      return n;
    })
    .option("--from <n>", "start at this event number (0 is the first)", (value) => {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 0) throw new InputError("--from must be 0 or more");
      return n;
    })
    .option("--ancestors", "also print the threads of the parent tasks")
    .action(async (ref, options) => {
      const reply = await client.thread(wsName(), ref, {
        ...(options.after ? { after: options.after } : {}),
        ...(options.from !== undefined ? { from: options.from } : {}),
        ...(options.limit ? { limit: options.limit } : {}),
        ...(options.ancestors ? { ancestors: "true" as const } : {}),
      });
      print(reply, () => formatThread(reply));
    });

  // ---- gate ----
  const gate = program.command("gate").description("Gates that wait for the human");
  gate
    .command("list")
    .description("List the open gates")
    .option("--task <task>", "only the gates of this task")
    .option("--all", "also the resolved gates")
    .action(async (options) => {
      const list = await client.gates(wsName(), {
        ...(options.task ? { task: options.task } : {}),
        ...(options.all ? { state: "all" as const } : {}),
      });
      print(list, () => formatGates(list));
    });
  gate
    .command("answer")
    .description("Answer a gate from this device")
    .argument("<gate>", "the gate id, or its first 8 or more characters")
    .argument("<answer>", "an option or a free answer")
    .option("--comment <text>", "a comment, for example with Request changes")
    .option(
      "--gate-version <n>",
      "the gate version that you answer (default: the current one)",
      (value) => {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 1)
          throw new InputError("--gate-version must be a number of 1 or more");
        return n;
      },
    )
    .action(async (ref, answer, options) => {
      const reply = await client.answerGate(wsName(), ref, {
        answer,
        ...(options.comment !== undefined ? { comment: options.comment } : {}),
        ...(options.gateVersion !== undefined ? { version: options.gateVersion } : {}),
      });
      printWrite(
        reply,
        [reply],
        () =>
          `Answered gate ${reply.gate.gate} of ${reply.gate.task.key ?? reply.gate.task.id}\n${formatGate(reply.gate)}`,
      );
    });

  // ---- engine, service (gap-install) ----
  addServiceCommands(program, {
    settings,
    client,
    deps: {
      runner: deps.runner ?? defaultRunner,
      platform: deps.platform ?? process.platform,
      uid: deps.uid ?? process.getuid?.() ?? userInfo().uid,
      ...(deps.engine ? { engine: deps.engine } : {}),
      ...(deps.keystores ? { keystores: deps.keystores } : {}),
      ...(deps.findTmux ? { findTmux: deps.findTmux } : {}),
    },
    print,
    resolvePath: (path) => resolve(cwd, path),
    inputError: (message) => new InputError(message),
    refusedError: (message) => new RefusedError(message),
  });
  addDoctorCommand(program, {
    settings,
    client,
    platform: deps.platform ?? process.platform,
    uid: deps.uid ?? process.getuid?.() ?? userInfo().uid,
    print,
    failed: () => {
      exitCode = EXIT.refused;
    },
    ...(deps.doctorProbes ? { probes: deps.doctorProbes } : {}),
  });

  // ---- queue (queue-and-assign) ----
  addQueueCommand(program, { client, workspace: wsName, print });
  addTerminalCommand(program, { client, workspace: wsName, print });

  // ---- kb, learn (add-knowledge-store) ----
  addKnowledgeCommands(program, {
    client,
    wsName,
    print,
    readText,
    inputError: (message) => new InputError(message),
    notApplied: (message) => {
      io.stderr(`${message}\n`);
      exitCode = EXIT.refused;
    },
  });

  // ---- sync ----
  addSyncCommands(program, client, {
    socketPath: settings.socketPath,
    print,
    notSynced: () => {
      exitCode = EXIT.refused;
    },
    fail: (message) => {
      throw new InputError(message);
    },
  });

  // ---- workspace, project, binding and sync community setup (gap-setup) ----
  addSetupCommands(program, {
    client,
    wsName,
    print,
    inputError: (message) => new InputError(message),
    resolvePath: (path) => resolve(cwd, path),
    inSession: settings.sessions.session !== null,
    refusedError: (message) => new RefusedError(message),
    failed: () => {
      exitCode = EXIT.refused;
    },
  });

  // ---- identity, device, pair, credential (add-identity-and-pairing) ----
  addIdentityCommands(program, {
    client,
    wsName,
    print,
    note: (text) => io.stderr(`${text}\n`),
    readText,
    resolvePath: (path) => resolve(cwd, path),
    refused: () => {
      exitCode = EXIT.refused;
    },
    inputError: (message) => new InputError(message),
  });

  // The agent commands of a session (add-claude-sessions-tmux, add-task-loop).
  addAgentCommands(program, {
    gate,
    readText,
    client,
    settings,
    cwd,
    print,
    inputError: (message) => new InputError(message),
    refused: () => {
      exitCode = EXIT.refused;
    },
  });

  try {
    await program.parseAsync(argv, { from: "user" });
  } catch (error) {
    return exitCodeOf(error, io, settings);
  }
  return exitCode;
}

function exitCodeOf(error: unknown, io: CliIo, settings: Settings): number {
  if (error instanceof CommanderError) {
    // Help and version end with exit code 0; commander printed the error text.
    return error.exitCode === 0 ? EXIT.ok : EXIT.invalid;
  }
  if (error instanceof InputError) {
    io.stderr(`aw: ${error.message}\n`);
    return EXIT.invalid;
  }
  if (error instanceof RefusedError) {
    io.stderr(`aw: ${error.message}\n`);
    return EXIT.refused;
  }
  if (error instanceof AwUnreachableError || error instanceof AwProtocolError) {
    io.stderr(
      `aw: awd is not running on ${settings.socketPath} (${error instanceof AwUnreachableError ? error.reason : error.message}).\n` +
        'Start it with "aw service install", or run "awd" in a terminal.\n',
    );
    return EXIT.unreachable;
  }
  if (error instanceof AwApiError) {
    const details = error.details === undefined ? "" : `\n${JSON.stringify(error.details)}`;
    io.stderr(`aw: ${error.message} [${error.code}, trace ${error.traceId ?? "-"}]${details}\n`);
    if (error.code === "written_not_merged") {
      io.stderr("aw: The write is saved. Do not run the command again.\n");
    }
    return error.status === 400 || error.status === 404 ? EXIT.invalid : EXIT.refused;
  }
  io.stderr(`aw: ${(error as Error).message ?? String(error)}\n`);
  return EXIT.refused;
}
