// The setup commands (openspec gap-setup): `aw workspace rename|edit|remove`, `aw project
// edit|archive|unarchive|remove` (remove: openspec project-remove), `aw binding show|set|remove|slot|orca` and `aw sync community`. They
// call the local API; awd does the work.
import type { AwClient } from "@aw/client";
import { SetupClient, type ProjectRemovalView, type RemoveProjectReply } from "@aw/client/setup";
import type {
  BindingsView,
  EditProjectInput,
  EditWorkspaceInput,
  SyncSettingsView,
} from "@aw/client/views";
import { Option, type Command } from "@commander-js/extra-typings";

export interface SetupCommandContext {
  client: AwClient;
  wsName: () => string;
  print: (value: unknown, text: () => string) => void;
  inputError: (message: string) => Error;
  resolvePath: (path: string) => string;
  /** True in an agent session (AW_SESSION is set). */
  inSession: boolean;
  refusedError: (message: string) => Error;
  /** Sets exit code 1 (a preview with no `--yes`). */
  failed: () => void;
}

/** The text of the preview of `aw project remove` (openspec project-remove). */
export function formatRemoval(r: ProjectRemovalView): string {
  const name =
    r.project.name === r.project.slug ? r.project.slug : `${r.project.name} (${r.project.slug})`;
  const lines = [`Remove the project ${name}?`];
  lines.push(
    r.tasks.length === 0
      ? "Open tasks: none"
      : `Open tasks (${r.tasks.length}): ${r.tasks.map((t) => `${t.key ?? t.id} ${t.title ?? ""}`.trim()).join("; ")}`,
  );
  lines.push(
    r.sessions.length === 0
      ? "Running sessions: none"
      : `Running sessions (${r.sessions.length}), each device stops its own: ${r.sessions.map((s) => `${s.key ?? s.task} on ${s.device}`).join("; ")}`,
  );
  lines.push(
    "The tasks leave each view. AW keeps the task folders and a copy of project.yaml, and keeps a worktree or a branch with unpushed work.",
  );
  return lines.join("\n");
}

/** The text of the reply of `aw project remove --yes`. */
export function formatRemoved(r: RemoveProjectReply): string {
  const lines = [`Removed project ${r.project.slug}. You can add ${r.project.slug} again.`];
  if (r.sessions.length > 0) {
    lines.push(
      `Sessions that stop (each device stops its own): ${r.sessions.map((s) => `${s.key ?? s.task} on ${s.device}`).join("; ")}`,
    );
  }
  for (const item of r.cleanup) {
    const what =
      [item.path, item.branch].filter(Boolean).join(" on the branch ") || (item.key ?? item.task);
    lines.push(
      item.result === "removed" ? `Removed ${what}` : `Kept ${what}: ${item.reason ?? "kept"}`,
    );
  }
  lines.push("Each other device cleans its own worktrees and branches when it syncs.");
  return lines.join("\n");
}

/** The text of `aw binding show`. */
export function formatBindings(b: BindingsView): string {
  const lines = [
    `Device: ${b.device}${b.may_run ? "" : " (runs no agent)"}`,
    `Use Orca: ${b.use_orca ? "on" : "off"}`,
  ];
  if (b.checkouts.length === 0)
    lines.push("Checkouts: none. Add one with: aw binding set <project> <path>");
  else {
    lines.push("Checkouts:");
    for (const c of b.checkouts) {
      lines.push(`  ${c.project}: ${c.path}${c.session_host ? ` (${c.session_host})` : ""}`);
    }
  }
  const slots = Object.entries(b.resources);
  lines.push(
    slots.length === 0
      ? "Test slots: none"
      : `Test slots: ${slots.map(([name, n]) => `${name} ${n}`).join(", ")}`,
  );
  return lines.join("\n");
}

/** The text of `aw sync community`. */
export function formatCommunity(s: SyncSettingsView): string {
  const state = s.community
    ? "on: community discovery and relay servers"
    : "off: LAN and Tailscale only";
  const source =
    s.source === "env" ? " (set by AW_SYNC_COMMUNITY)" : s.source === "default" ? " (default)" : "";
  const applied = s.applied === "next_start" ? "\nThe sync engine gets it at its next start." : "";
  return `Community servers: ${state}${source}\n${s.text}${applied}`;
}

function onOff(value: string, what: string, error: (message: string) => Error): boolean {
  const v = value.toLowerCase();
  if (v === "on") return true;
  if (v === "off") return false;
  throw error(`${what} must be on or off, not ${value}`);
}

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function find(program: Command, name: string): Command {
  const command = program.commands.find((c) => c.name() === name);
  if (!command) throw new Error(`The command ${name} is not registered`);
  return command as unknown as Command;
}

export function addSetupCommands(program: Command, ctx: SetupCommandContext): void {
  const setup = new SetupClient(ctx.client);
  const { print, wsName } = ctx;

  // ---- workspace ----
  const workspace = find(program, "workspace");
  workspace
    .command("rename")
    .description("Rename the workspace (the name in tasks/workspace.yaml)")
    .argument("<name>", "the new name")
    .action(async (name) => {
      const reply = await setup.renameWorkspace(wsName(), name);
      print(reply, () => `Renamed workspace ${reply.id} to ${reply.name ?? name}`);
    });
  workspace
    .command("edit")
    .description("Change the name or the permission mode of new projects (tasks/workspace.yaml)")
    .option("--name <name>", "the new name")
    .addOption(
      new Option(
        "--new-project-permission-mode <mode>",
        "the permission mode of new projects (default skip); existing projects keep their mode",
      ).choices(["default", "accept_edits", "skip"] as const),
    )
    .action(
      async (options: {
        name?: string;
        newProjectPermissionMode?: "default" | "accept_edits" | "skip";
      }) => {
        const body: EditWorkspaceInput = {};
        if (options.name !== undefined) body.name = options.name;
        if (options.newProjectPermissionMode !== undefined) {
          body.new_project_permission_mode = options.newProjectPermissionMode;
        }
        if (Object.keys(body).length === 0) {
          throw ctx.inputError("Give at least one option. See: aw workspace edit --help");
        }
        const reply = await setup.editWorkspace(wsName(), body);
        print(reply, () =>
          [
            `Changed workspace ${reply.name ?? reply.id}`,
            ...(reply.new_project_permission_mode
              ? [`New projects get the permission mode ${reply.new_project_permission_mode}`]
              : []),
          ].join("\n"),
        );
      },
    );
  workspace
    .command("remove")
    .description("Unregister the workspace on this device. The files stay in its folder.")
    .action(async () => {
      const reply = await setup.removeWorkspace(wsName());
      print(reply, () => reply.message);
    });

  // ---- project ----
  const project = find(program, "project");
  project
    .command("edit")
    .description("Change the settings of a project (a list option replaces the whole list)")
    .argument("<slug>", "the project slug")
    .option("--name <name>", "the display name")
    .option("--device <slug>", "an implementing device, in priority order (repeat)", collect)
    .option("--default-agent <agent>", "the agent of new tasks")
    .option("--link <url>", "a link of the project (repeat)", collect)
    .option("--clear-links", "remove each link except the main repository")
    .option("--main-repo <url>", "the main repository, or none")
    .option("--test-server <name>", "a test server name (repeat)", collect)
    .option("--clear-test-servers", "remove each test server")
    .option("--subtasks-to-default-device <on|off>", "assign new subtasks to the default device")
    .option(
      "--permission-mode <mode>",
      "default, accept_edits or skip: the mode of new sessions (skip only for tasks of a person)",
    )
    .action(async (slug, options) => {
      const body: EditProjectInput = {};
      if (options.name !== undefined) body.name = options.name;
      if (options.device) body.devices = options.device;
      if (options.defaultAgent !== undefined) body.default_agent = options.defaultAgent;
      if (options.link) body.links = options.link;
      else if (options.clearLinks) body.links = [];
      if (options.mainRepo !== undefined) {
        body.main_repo = options.mainRepo === "none" ? null : options.mainRepo;
      }
      if (options.testServer) body.test_servers = options.testServer;
      else if (options.clearTestServers) body.test_servers = [];
      if (options.subtasksToDefaultDevice !== undefined) {
        body.switches = {
          assign_new_subtasks_to_default_device: onOff(
            options.subtasksToDefaultDevice,
            "--subtasks-to-default-device",
            ctx.inputError,
          ),
        };
      }
      if (options.permissionMode !== undefined) {
        const mode = options.permissionMode;
        if (mode !== "default" && mode !== "accept_edits" && mode !== "skip") {
          throw ctx.inputError("--permission-mode must be default, accept_edits or skip");
        }
        body.permission_mode = mode;
      }
      if (Object.keys(body).length === 0) {
        throw ctx.inputError("Give at least one option. See: aw project edit --help");
      }
      const reply = await setup.editProject(wsName(), slug, body);
      print(reply, () => `Changed project ${reply.slug}`);
    });
  project
    .command("archive")
    .description("Archive a project: it gets no new tasks. AW keeps its files.")
    .argument("<slug>", "the project slug")
    .action(async (slug) => {
      const reply = await setup.editProject(wsName(), slug, { archived: true });
      print(reply, () => `Archived project ${reply.slug}`);
    });
  project
    .command("remove")
    .description(
      "Remove a project from AW: its tasks leave each view, each device stops its sessions, and the slug is free. AW keeps the files.",
    )
    .argument("<slug>", "the project slug")
    .option("--yes", "remove it; with no --yes, show what the remove stops")
    .action(async (slug, options: { yes?: boolean }) => {
      if (!options.yes) {
        const preview = await setup.projectRemoval(wsName(), slug);
        print(preview, () => `${formatRemoval(preview)}\nAdd --yes to remove it.`);
        ctx.failed();
        return;
      }
      const reply = await setup.removeProject(wsName(), slug);
      print(reply, () => formatRemoved(reply));
    });
  project
    .command("unarchive")
    .description("Make an archived project active again")
    .argument("<slug>", "the project slug")
    .action(async (slug) => {
      const reply = await setup.editProject(wsName(), slug, { archived: false });
      print(reply, () => `Project ${reply.slug} is active`);
    });

  // ---- binding ----
  const binding = program
    .command("binding")
    .description("The bindings of this device: checkouts, test slots and Use Orca");
  binding
    .command("show")
    .description("Show the bindings of this device")
    .action(async () => {
      const reply = await setup.bindings(wsName());
      print(reply, () => formatBindings(reply));
    });
  binding
    .command("set")
    .description("Bind the checkout of a project on this device")
    .argument("<project>", "the project slug")
    .argument("<path>", "the checkout folder (a git repository)")
    .option(
      "--host <host>",
      "the session host of this project: tmux, orca or default (no option keeps the host)",
    )
    .action(async (projectSlug, path, options) => {
      const host = options.host;
      if (host !== undefined && host !== "tmux" && host !== "orca" && host !== "default") {
        throw ctx.inputError(`--host must be tmux, orca or default, not ${host}`);
      }
      const reply = await setup.editBindings(wsName(), {
        checkouts: [
          {
            project: projectSlug,
            path: ctx.resolvePath(path),
            ...(host === undefined ? {} : { session_host: host === "default" ? null : host }),
          },
        ],
      });
      print(reply, () => formatBindings(reply));
    });
  binding
    .command("remove")
    .description("Remove the checkout of a project on this device")
    .argument("<project>", "the project slug")
    .action(async (projectSlug) => {
      const reply = await setup.editBindings(wsName(), {
        checkouts: [{ project: projectSlug, path: null }],
      });
      print(reply, () => formatBindings(reply));
    });
  binding
    .command("slot")
    .description("Set the capacity of a test slot resource on this device (0 removes it)")
    .argument("<resource>", "the resource name, for example k3d")
    .argument("<capacity>", "the count of sessions that can hold it at the same time")
    .action(async (resource, capacity) => {
      if (!/^[0-9]{1,4}$/.test(capacity)) {
        throw ctx.inputError(`<capacity> must be a whole number from 0 to 1000, not ${capacity}`);
      }
      const count = Number(capacity);
      const current = await setup.bindings(wsName());
      const resources = { ...current.resources };
      if (count === 0) delete resources[resource];
      else resources[resource] = count;
      const reply = await setup.editBindings(wsName(), { resources });
      print(reply, () => formatBindings(reply));
    });
  binding
    .command("orca")
    .description("Use Orca on this device for new sessions: on or off")
    .argument("<on|off>", "on or off")
    .action(async (value) => {
      const reply = await setup.editBindings(wsName(), {
        use_orca: onOff(value, "<on|off>", ctx.inputError),
      });
      print(reply, () => formatBindings(reply));
    });

  // ---- sync community ----
  find(program, "sync")
    .command("community")
    .description("Show or set 'Use community discovery and relay servers' (on or off)")
    .argument("[on|off]", "on or off; leave it out to show the value")
    .action(async (value) => {
      // A read is fine for an agent; a change is a command of a person (gap-setup L8).
      if (value !== undefined && ctx.inSession) {
        throw ctx.refusedError(
          "aw sync community on|off is a command of a person, and this is an agent session (AW_SESSION is set). Ask the human with aw ask.",
        );
      }
      const reply =
        value === undefined
          ? await setup.syncSettings()
          : await setup.setSyncSettings(onOff(value, "[on|off]", ctx.inputError));
      print(reply, () => formatCommunity(reply));
    });
}
