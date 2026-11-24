// The agent commands of the aw CLI (docs/workflow.md 8, design decision 16) and `aw session`. An
// agent command runs inside an AW session: the session comes from AW_SESSION, which aw-launch sets.
import type { AwClient } from "@aw/client";
import type { Command } from "@commander-js/extra-typings";
import { resolve } from "node:path";
import type { Settings } from "../settings.ts";

export interface AgentCommandContext {
  client: AwClient;
  settings: Settings;
  cwd: string;
  print: (value: unknown, text: () => string) => void;
  /** Makes the error of an input that the CLI refuses (exit code 2). */
  inputError: (message: string) => Error;
  /** The `aw gate` command group: `aw gate open` is an agent command in it. */
  gate: Command;
  /** Reads a file, or stdin for `-`. */
  readText: (path: string) => Promise<string>;
  /** Sets exit code 1 (a slot in the queue, not a lease). */
  refused?: () => void;
}

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

export function addAgentCommands(program: Command, context: AgentCommandContext): void {
  const { client, print } = context;
  const session = (): string => {
    const value = context.settings.sessions.session?.id;
    if (!value) {
      throw context.inputError(
        "Run this command inside an AW session: AW_SESSION is not set. A person answers gates with aw gate answer.",
      );
    }
    return value;
  };

  program
    .command("ask")
    .description("Ask the human: opens the gate Answer question and returns at once")
    .argument("<task>", "the task key or id of this session")
    .argument("<text>", "the question")
    .option("--details <text>", "the full context of the decision as Markdown")
    .option("--details-file <path>", "the full context as a Markdown file; - reads stdin")
    .option("--options <list>", 'the answer options, separated by "|"')
    .option(
      "--option <label::description>",
      'one answer option with a description, for example "Library A::Runs in the same process" (repeat)',
      collect,
    )
    .action(async (task, text, options) => {
      if (options.details !== undefined && options.detailsFile !== undefined) {
        throw context.inputError(
          "Give the details with --details or with --details-file, not both",
        );
      }
      if (options.options !== undefined && options.option !== undefined) {
        throw context.inputError("Give the options with --options or with --option, not both");
      }
      const details =
        options.detailsFile !== undefined
          ? await context.readText(options.detailsFile)
          : options.details;
      if (details !== undefined && details.trim() === "") {
        throw context.inputError("The details are empty");
      }
      const list =
        options.option !== undefined
          ? options.option.map((value) => {
              const at = value.indexOf("::");
              const label = (at < 0 ? value : value.slice(0, at)).trim();
              const description = at < 0 ? "" : value.slice(at + 2).trim();
              if (!label) throw context.inputError(`--option ${value} has no label`);
              return description ? { label, description } : label;
            })
          : (options.options ?? "")
              .split("|")
              .map((o) => o.trim())
              .filter(Boolean);
      const reply = await client.ask(session(), {
        task,
        text,
        ...(details !== undefined ? { details } : {}),
        options: list,
      });
      print(
        reply,
        () =>
          `Question sent to the human as gate ${reply.gate}. End your turn now. Do not wait or poll: the answer arrives as your next input, after "[AW answer ${reply.gate}]".`,
      );
    });

  program
    .command("message")
    .description("Write a message to the human in the thread (message.agent)")
    .argument("<task>", "the task key or id of this session")
    .argument("<text>", "the message")
    .action(async (task, text) => {
      const reply = await client.agentMessage(session(), { task, text });
      print(reply, () => `Message ${reply.event.id} written to the thread.`);
    });

  program
    .command("stage")
    .description("Update the progress line of the task (task.progress)")
    .argument("<task>", "the task key or id of this session")
    .argument("<text>", 'the progress, for example "Running the tests"')
    .action(async (task, text) => {
      const reply = await client.stage(session(), { task, text });
      print(reply, () => `Progress set: ${text}`);
    });

  const artifact = program.command("artifact").description("Files of the task");
  artifact
    .command("add")
    .description("Copy a file into the task folder (artifact.added)")
    .argument("<task>", "the task key or id of this session")
    .argument("<file>", "the file, for example a test report")
    .action(async (task, file) => {
      const reply = await client.addArtifact(session(), { task, path: resolve(context.cwd, file) });
      print(reply, () => `Artifact ${reply.path ?? ""} added.`);
    });

  program
    .command("handoff")
    .description("Write the context for the next session (handoff.written)")
    .argument("<task>", "the task key or id of this session")
    .requiredOption("--file <path>", "a Markdown file: plan, decisions, open questions")
    .action(async (task, options) => {
      const reply = await client.handoff(session(), {
        task,
        path: resolve(context.cwd, options.file),
      });
      print(reply, () => `Handoff ${reply.path ?? ""} written.`);
    });

  // ---- The work loop (add-task-loop) ----
  const decisionsOf = async (file: string | undefined) => {
    if (file === undefined) return [];
    const raw = await context.readText(file);
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch (error) {
      throw context.inputError(`--decisions ${file} is not JSON: ${(error as Error).message}`);
    }
    if (!Array.isArray(value)) {
      throw context.inputError(
        '--decisions must be a JSON array of {"question", "options", "recommended"}',
      );
    }
    return value as { question: string; options: string[]; recommended: string }[];
  };

  program
    .command("approach")
    .description("Propose the approach: a new version and the gate Confirm approach")
    .argument("<task>", "the task key or id of this session")
    .requiredOption("--file <path>", "the approach as Markdown; - reads stdin")
    .option(
      "--decisions <path>",
      'a JSON array of decisions: [{"question", "options": [...], "recommended"}]',
    )
    .action(async (task, options) => {
      const reply = await client.approach(session(), {
        task,
        content: await context.readText(options.file),
        decisions: await decisionsOf(options.decisions),
      });
      print(reply, () => reply.next);
    });

  program
    .command("ready")
    .description("Report ready to implement; each --missing item becomes a question")
    .argument("<task>", "the task key or id of this session")
    .option("--missing <item>", "an item that you still need (repeat)", collect)
    .action(async (task, options) => {
      const reply = await client.reportReady(session(), { task, missing: options.missing ?? [] });
      print(reply, () => reply.next);
    });

  program
    .command("result")
    .description("Post the result: the gate Approve result, and the stage Review")
    .argument("<task>", "the task key or id of this session")
    .requiredOption("--file <path>", "the result as Markdown in your working folder")
    .option("--artifact <path>", "a file to add with the result (repeat)", collect)
    .action(async (task, options) => {
      const reply = await client.result(session(), {
        task,
        path: resolve(context.cwd, options.file),
        artifacts: (options.artifact ?? []).map((p) => resolve(context.cwd, p)),
      });
      print(reply, () => reply.next);
    });

  program
    .command("done")
    .description("End the task after the human approved the result")
    .argument("<task>", "the task key or id of this session")
    .action(async (task) => {
      const reply = await client.done(session(), { task });
      print(reply, () => reply.next);
    });

  context.gate
    .command("open")
    .description("Open a custom gate with Markdown and optional decisions (an agent command)")
    .argument("<task>", "the task key or id of this session")
    .requiredOption("--file <path>", "the gate text as Markdown; - reads stdin")
    .option("--decisions <path>", "a JSON array of decisions")
    .option("--options <list>", 'the answer options, separated by "|"')
    .action(async (task, options) => {
      const reply = await client.openGate(session(), {
        task,
        content: await context.readText(options.file),
        decisions: await decisionsOf(options.decisions),
        options: (options.options ?? "")
          .split("|")
          .map((o) => o.trim())
          .filter(Boolean),
      });
      print(reply, () => reply.next);
    });

  // Test slots (add-continuity): a lease from the device that has the resource.
  const slot = program.command("slot").description("Test slot leases (agent commands)");
  slot
    .command("acquire")
    .description("Lease a test slot, renew your lease, or get your queue position (exit code 1)")
    .argument("<resource>", "the slot resource, for example k3d")
    .action(async (resource) => {
      const reply = await client.slotAcquire(session(), { resource });
      print(reply, () => reply.next);
      if (reply.lease === null) context.refused?.();
    });
  slot
    .command("release")
    .description("Release your lease of a test slot")
    .argument("<resource>", "the slot resource, for example k3d")
    .action(async (resource) => {
      const reply = await client.slotRelease(session(), { resource });
      print(reply, () => reply.next);
    });

  const sessions = program.command("session").description("Agent sessions of this device");
  sessions
    .command("list")
    .description("List the sessions of this device")
    .action(async () => {
      const list = await client.sessions();
      print(list, () =>
        list.length === 0
          ? "No session."
          : list
              .map(
                (s) =>
                  `${s.id}  ${s.key ?? s.task}  ${s.state}  epoch ${s.epoch}  pid ${s.pid ?? "-"}  resumes ${s.resumes}  ${s.cwd}`,
              )
              .join("\n"),
      );
    });
  sessions
    .command("stop")
    .description("Stop a session by its process group")
    .argument("<session>", "the session id")
    .action(async (id) => {
      const reply = await client.stopSession(id);
      print(reply, () => `Stopped session ${reply.id} of ${reply.key ?? reply.task}.`);
    });
}
