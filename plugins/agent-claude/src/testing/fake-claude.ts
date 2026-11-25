// A fake `claude` for tests (docs/engineering-rules.md 7.5): the launch flags, `--resume`, the trust
// screen, the hooks of the plugin with captured payloads, a transcript, bracketed paste, a
// permission dialog. It has no model: it reacts to small commands in each input.
//
//   ask <question> | <a|b>      runs `aw ask <task> <question> --options <a|b>`, then ends the turn
//   ask-tool <question> | <a|b> calls the AskUserQuestion tool
//   ask-tool-json <json>        calls the AskUserQuestion tool with this tool input (questions with
//                               headers, multiSelect and option descriptions)
//   plan <text>                 calls the ExitPlanMode tool
//   plan-file <file>            calls the ExitPlanMode tool with the text of a file in its folder
//   write <file> <text>         calls the Write tool (a permission request in the default mode)
//   write-large <file> <bytes>  calls the Write tool with <bytes> characters of content
//   write-then-ask <file> <q>   calls the Write tool; when it is denied, ends the turn with <q>
//   bash <command>              calls the Bash tool (`aw ...` is allowed, else a permission request)
//   mcp <tool> <json>           calls a tool of the AW MCP server of the plugin `.mcp.json`, with the
//                               variables of this process, and ends the turn with the result
//   reply <text>                ends the turn with this text
//   message-then-reply <m> | <r> runs `aw message <task> <m>` (the Bash tool), then ends the turn
//                               with <r>; `\n` in <r> is a line break (a long turn text)
//   use-credential <name> <n>   reads $AW_CREDENTIALS_DIR/<name> and writes the value into
//                               proposal.md, notes.txt, result.md, handoff.md, build.log, ps.txt and image.bin (bytes
//                               that are not UTF-8) in its folder, then ends the turn with a reply
//                               of <n> characters (default 40000) that has the value
//   show-credential-wrapped <name> <n>
//                               shows the value of the credential on the screen with a real line
//                               break after <n> characters (the wrap of a TUI), then ends the turn
//   wait <ms>                   ends the turn after <ms> ms (a long turn)
//   copy-files <folder>         copies each file of <folder> into its folder (no tool call), then
//                               ends the turn with the file names
//   Approved: run it again      runs the last denied tool call again
//   steps                       ends the turn; each later line of this input is then one input
//                               (a script of turns, for example in a first message)
//   exit                        ends the session
//   stop-failure <error>        ends the turn with a StopFailure hook (for example rate_limit)
//   statusline <json>           runs the statusLine command of the --settings file with this JSON
//   any other text              ends the turn with "Got: <text>."
//
// Permission modes as in Claude Code (spike session-options): `bypassPermissions` asks no
// permission and shows the warning dialog at the start unless the --settings file has
// `skipDangerousModePermissionPrompt: true`; a `permissions.deny` rule of the --settings file
// (`Bash(<prefix>)` or `Bash(<prefix> *)`) denies a command whose text starts with it, in each mode.
// FAKE_CLAUDE_TRUST_ORDER=yes-first shows the trust screen with "Yes, I trust this folder" first and
// the cursor on it (the layout of a Claude Code version that the tests do not cover).
// `claude auth status --json` prints a logged-in state (the keys of the 2.1.330 capture);
// FAKE_CLAUDE_LOGGED_OUT=1 prints `loggedIn: false`, FAKE_CLAUDE_LOGIN_EXPIRES=<iso> sets the end.
// FAKE_CLAUDE_EXIT_AFTER_START=1 exits with 1 after each SessionStart (a crash before any progress).
// FAKE_CLAUDE_EXIT_ONCE=<file> exits with 1 before SessionStart when the file does not exist, and
// creates it (an agent that stops before its first prompt: no transcript, no hook).
// FAKE_CLAUDE_START_DELAY_MS=<ms> waits before it reads input and turns on bracketed paste (a
// Claude Code that loads): a text that comes in that time arrives raw, as on a real terminal.
//
// An input can start with an AW prefix (`[AW answer <id>] write a.txt x`): the command follows it.
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { execa } from "execa";
import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { transcriptPath } from "../claude.ts";
import { payload, type SessionFields } from "./payloads.ts";

interface Args {
  settings: string | null;
  sessionId: string | null;
  resume: string | null;
  name: string | null;
  pluginDir: string | null;
  permissionMode: string;
  allowedTools: string[];
  message: string | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    settings: null,
    sessionId: null,
    resume: null,
    name: null,
    pluginDir: null,
    permissionMode: "default",
    allowedTools: [],
    message: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = () => argv[++i] ?? "";
    if (arg === "--") {
      args.message = argv.slice(i + 1).join(" ");
      break;
    } else if (arg === "--session-id") args.sessionId = next();
    else if (arg === "--resume" || arg === "-r") args.resume = next();
    else if (arg === "-n" || arg === "--name") args.name = next();
    else if (arg === "--plugin-dir") args.pluginDir = next();
    else if (arg === "--permission-mode") args.permissionMode = next();
    else if (arg === "--allowedTools" || arg === "--allowed-tools") {
      while (i + 1 < argv.length && !argv[i + 1]!.startsWith("-")) args.allowedTools.push(next());
    } else if (arg === "--settings") args.settings = next();
    else if (arg === "--model") next();
    else if (arg === "--version") {
      process.stdout.write("2.1.330 (Claude Code)\n");
      process.exit(0);
    }
  }
  return args;
}

const env = process.env;
if (process.argv[2] === "auth" && process.argv[3] === "status") {
  process.stdout.write(
    `${JSON.stringify({
      loggedIn: env.FAKE_CLAUDE_LOGGED_OUT !== "1",
      authMethod: "claude.ai",
      apiProvider: "firstParty",
      loginExpiresAt: env.FAKE_CLAUDE_LOGIN_EXPIRES ?? "2099-01-01T00:00:00.000Z",
    })}\n`,
  );
  process.exit(env.FAKE_CLAUDE_LOGGED_OUT === "1" ? 1 : 0);
}
const args = parseArgs(process.argv.slice(2));
const home = env.HOME ?? "/";
const configDir = env.CLAUDE_CONFIG_DIR || join(home, ".claude");
const stateFile = join(env.CLAUDE_CONFIG_DIR || home, ".claude.json");
const cwd = process.cwd();
const sessionId = args.resume ?? args.sessionId ?? randomUUID();
const transcript = transcriptPath(configDir, cwd, sessionId);
const session: SessionFields = {
  session_id: sessionId,
  transcript_path: transcript,
  cwd,
  permission_mode: args.permissionMode,
};
const out = (text: string) => process.stdout.write(text.replace(/\n/g, "\r\n"));

if (args.resume && !existsSync(transcript)) {
  out(`No conversation found with session ID: ${args.resume}\n`);
  process.exit(1);
}
// Claude Code refuses a new session with the id of an existing conversation.
if (!args.resume && args.sessionId && existsSync(transcript)) {
  out(`Error: Session ID ${args.sessionId} is already in use.\n`);
  process.exit(1);
}

function record(kind: string, data: Record<string, unknown>): void {
  mkdirSync(dirname(transcript), { recursive: true });
  appendFileSync(transcript, `${JSON.stringify({ type: kind, sessionId, ...data })}\n`);
}

// ---- Terminal input: raw mode, bracketed paste, a queue of inputs and dialog keys. ----
type KeyWaiter = (key: string) => void;
let keyWaiter: KeyWaiter | null = null;
let line = "";
let pasting = false;
const inputs: string[] = [];
let wakeTurn: (() => void) | null = null;

function onData(chunk: string): void {
  let rest = chunk;
  while (rest.length > 0) {
    if (keyWaiter && !pasting) {
      const waiter = keyWaiter;
      keyWaiter = null;
      const key = rest.startsWith("\u001b[") ? rest.slice(0, 3) : rest[0]!;
      rest = rest.slice(key.length);
      waiter(key);
      continue;
    }
    if (pasting) {
      const end = rest.indexOf("\u001b[201~");
      const part = end < 0 ? rest : rest.slice(0, end);
      line += part.replace(/\r\n?/g, "\n");
      if (end < 0) return;
      pasting = false;
      rest = rest.slice(end + 6);
      continue;
    }
    if (rest.startsWith("\u001b[200~")) {
      pasting = true;
      rest = rest.slice(6);
      continue;
    }
    const char = rest[0]!;
    rest = rest.slice(1);
    if (char === "\r" || char === "\n") {
      if (line.length > 0) {
        inputs.push(line);
        line = "";
        wakeTurn?.();
      }
    } else if (char === "\u0003") process.exit(130);
    else if (char === "\u007f") line = line.slice(0, -1);
    else if (char !== "\u001b") line += char;
  }
}

function nextKey(): Promise<string> {
  return new Promise((resolve) => (keyWaiter = resolve));
}

// ---- Hooks: the commands of the plugin hooks.json, with JSON on stdin. ----
interface HookConfig {
  hooks: Record<string, { hooks: { type: string; command: string; timeout?: number }[] }[]>;
}

const hookConfig: HookConfig = args.pluginDir
  ? (JSON.parse(readFileSync(join(args.pluginDir, "hooks", "hooks.json"), "utf8")) as HookConfig)
  : { hooks: {} };

async function hook(
  key: string,
  fields: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const event = key.split(".")[0]!;
  let reply: Record<string, unknown> = {};
  for (const group of hookConfig.hooks[event] ?? []) {
    for (const item of group.hooks) {
      const result = await execa("sh", ["-c", item.command], {
        input: JSON.stringify(payload(key, session, fields)),
        env: { ...env, CLAUDE_PLUGIN_ROOT: args.pluginDir ?? "" },
        reject: false,
        timeout: (item.timeout ?? 60) * 1000,
      });
      const text = String(result.stdout ?? "").trim();
      if (text.startsWith("{")) {
        try {
          reply = JSON.parse(text) as Record<string, unknown>;
        } catch {
          // A hook that prints no JSON gives no reply.
        }
      }
    }
  }
  return reply;
}

function specific(reply: Record<string, unknown>): Record<string, unknown> {
  const value = reply.hookSpecificOutput;
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

// ---- Trust screen (copied from the capture a1-trust-dialog of 2026-11-22). ----
function trusted(): boolean {
  if (!existsSync(stateFile)) return false;
  const state = JSON.parse(readFileSync(stateFile, "utf8")) as {
    projects?: Record<string, { hasTrustDialogAccepted?: boolean }>;
  };
  let path = cwd;
  for (;;) {
    if (state.projects?.[path]?.hasTrustDialogAccepted === true) return true;
    const parent = dirname(path);
    if (parent === path) return false;
    path = parent;
  }
}

async function trustScreen(): Promise<void> {
  const yesFirst = env.FAKE_CLAUDE_TRUST_ORDER === "yes-first";
  let yes = yesFirst;
  for (;;) {
    const no = ` ${yes ? " " : "❯"} No, exit`;
    const trust = ` ${yes ? "❯" : " "} Yes, I trust this folder`;
    out("\u001b[2J\u001b[H");
    out(
      [
        " Accessing workspace:",
        "",
        ` ${cwd}`,
        "",
        " Quick safety check: Is this a project you created or one you trust?",
        "",
        ...(yesFirst ? [trust, no] : [no, trust]),
        "",
        " Enter to confirm · Esc to cancel",
        "",
      ].join("\n"),
    );
    const key = await nextKey();
    if (key === "\u001b[B") yes = !yesFirst;
    else if (key === "\u001b[A") yes = yesFirst;
    else if (key === "\r") {
      if (!yes) process.exit(1);
      const state = existsSync(stateFile)
        ? (JSON.parse(readFileSync(stateFile, "utf8")) as Record<string, unknown>)
        : {};
      const projects = (state.projects ?? {}) as Record<string, Record<string, unknown>>;
      projects[cwd] = { ...(projects[cwd] ?? {}), hasTrustDialogAccepted: true };
      writeFileSync(stateFile, JSON.stringify({ ...state, projects }, null, 2));
      out("\u001b[2J\u001b[H");
      return;
    } else if (key === "\u001b") process.exit(1);
  }
}

// ---- Tools ----
/** The --settings file as JSON, or an empty object. */
function settingsFile(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(args.settings ?? "", "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** The deny rule of the --settings file that matches the command text (as Claude Code: text only). */
function deniedByRule(tool: string, input: Record<string, unknown>): string | null {
  const permissions = settingsFile().permissions as { deny?: unknown } | undefined;
  const rules = Array.isArray(permissions?.deny) ? (permissions.deny as string[]) : [];
  const command = typeof input.command === "string" ? input.command.trim() : "";
  for (const rule of rules) {
    const match = /^(\w+)\((.*?)( \*)?\)$/.exec(rule);
    if (!match || match[1] !== tool) continue;
    if (command === match[2] || (match[3] && command.startsWith(`${match[2]} `))) {
      return `Permission to use ${tool} with command ${command} has been denied.`;
    }
  }
  return null;
}

function allowedByRule(tool: string, input: Record<string, unknown>): boolean {
  if (tool === "AskUserQuestion" || tool === "ExitPlanMode") return true;
  if (args.permissionMode === "bypassPermissions") return true;
  if (tool === "Write" && args.permissionMode === "acceptEdits") return true;
  for (const rule of args.allowedTools) {
    // An MCP rule: `mcp__plugin_aw_aw__*` allows each tool of that server.
    if (rule.endsWith("__*") && tool.startsWith(rule.slice(0, -1))) return true;
    const match = /^(\w+)\((.*) \*\)$/.exec(rule);
    if (
      match &&
      match[1] === tool &&
      (typeof input.command === "string" ? input.command : "").startsWith(`${match[2]} `)
    ) {
      return true;
    }
  }
  return false;
}

async function permission(
  tool: string,
  input: Record<string, unknown>,
): Promise<{ allow: boolean; message: string }> {
  out(`\n Do you want to use ${tool}?\n ❯ 1. Yes\n   3. No\n\n Esc to cancel\n`);
  let settled = false;
  const notify = setTimeout(() => {
    if (!settled)
      void hook("Notification", {
        message: "Claude needs your permission",
        notification_type: "permission_prompt",
      });
  }, 1000);
  const fromHook = hook(`PermissionRequest.${tool}`, { tool_name: tool, tool_input: input }).then(
    (reply) => {
      const decision = specific(reply).decision as
        { behavior?: string; message?: string } | undefined;
      if (!decision?.behavior) return null;
      return {
        allow: decision.behavior === "allow",
        message: decision.message ?? "Denied by the PermissionRequest hook",
      };
    },
  );
  const fromKey = (async () => {
    for (;;) {
      const key = await nextKey();
      if (key === "1" || key === "\r") return { allow: true, message: "" };
      if (key === "3" || key === "\u001b") return { allow: false, message: "The user said no" };
    }
  })();
  const hookResult = await Promise.race([fromHook, fromKey.then((r) => ({ key: r }))]);
  let result: { allow: boolean; message: string };
  if (hookResult && !("key" in hookResult)) result = hookResult;
  else if (hookResult && "key" in hookResult) result = hookResult.key;
  else result = await fromKey;
  settled = true;
  clearTimeout(notify);
  keyWaiter = null;
  // Claude Code draws the dialog again without it: the visible screen has no dialog text.
  out("\u001b[2J\u001b[H");
  return result;
}

let lastDenied: {
  name: string;
  input: Record<string, unknown>;
  run: () => Promise<string>;
} | null = null;

async function tool(
  name: string,
  input: Record<string, unknown>,
  run: () => Promise<string>,
): Promise<{ ok: boolean; text: string }> {
  const toolUseId = `toolu_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  out(`● ${name}(${JSON.stringify(input).slice(0, 120)})\n`);
  const pre = specific(
    await hook(`PreToolUse.${name}`, {
      tool_name: name,
      tool_input: input,
      tool_use_id: toolUseId,
    }),
  );
  if (pre.permissionDecision === "deny") {
    const reason =
      typeof pre.permissionDecisionReason === "string" ? pre.permissionDecisionReason : "";
    out(`  ⎿  Error: ${reason}\n`);
    return { ok: false, text: reason };
  }
  const ruleDeny = deniedByRule(name, input);
  if (ruleDeny !== null) {
    out(`  ⎿  Error: ${ruleDeny}\n`);
    return { ok: false, text: ruleDeny };
  }
  if (!allowedByRule(name, input)) {
    const decision = await permission(name, input);
    if (!decision.allow) {
      out(`  ⎿  Error: ${decision.message}\n`);
      lastDenied = { name, input, run };
      return { ok: false, text: decision.message };
    }
  }
  const text = await run();
  await hook("PostToolUse", {
    tool_name: name,
    tool_input: input,
    tool_use_id: toolUseId,
    tool_response: { output: text.slice(0, 2000) },
  });
  out(`  ⎿  ${text.split("\n")[0] ?? ""}\n`);
  return { ok: true, text };
}

function awBinary(): string {
  return join(args.pluginDir ?? "", "bin", "aw");
}

/** Splits `text | a|b` into the question and the options. */
function questionOf(rest: string): { question: string; options: string[] } {
  const bar = rest.indexOf(" | ");
  if (bar < 0) return { question: rest.trim(), options: [] };
  return {
    question: rest.slice(0, bar).trim(),
    options: rest
      .slice(bar + 3)
      .split("|")
      .map((o) => o.trim())
      .filter(Boolean),
  };
}

async function stop(text: string): Promise<void> {
  out(`● ${text}\n\n❯ `);
  record("assistant", { message: { role: "assistant", content: text } });
  await hook("Stop", {
    last_assistant_message: text,
    stop_hook_active: false,
    background_tasks: [],
    session_crons: [],
  });
}

/** Expands `${VAR}` and `${VAR:-default}` as Claude Code does in `.mcp.json`. */
function expand(value: string): string {
  return value.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g,
    (_, name: string, fallback?: string) => {
      const set = env[name];
      return set !== undefined && set !== "" ? set : (fallback ?? "");
    },
  );
}

/** Calls a tool of the server `aw` of the plugin `.mcp.json` (the MCP config of Claude Code). */
async function mcpCall(name: string, input: Record<string, unknown>): Promise<string> {
  const config = JSON.parse(readFileSync(join(args.pluginDir ?? "", ".mcp.json"), "utf8")) as {
    mcpServers: Record<string, { url: string; headers?: Record<string, string> }>;
  };
  const server = config.mcpServers.aw!;
  const headers = Object.fromEntries(
    Object.entries(server.headers ?? {}).map(([key, value]) => [key, expand(value)]),
  );
  const client = new Client({ name: "fake-claude", version: "0.0.0" });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(expand(server.url)), { requestInit: { headers } }),
    );
    const result = await client.callTool({ name, arguments: input });
    const content = result.content as { type: string; text?: string }[];
    return `${result.isError ? "MCP error " : "MCP result "}${content.map((c) => c.text ?? "").join("")}`;
  } catch (error) {
    return `MCP failed: ${(error as Error).message}`;
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function turn(text: string): Promise<boolean> {
  out(`❯ ${text}\n`);
  record("user", { message: { role: "user", content: text } });
  await hook("UserPromptSubmit", { prompt: text, prompt_id: randomUUID() });
  const body = text.replace(/^\[AW [^\]]*\]\s*/, "");
  const firstLine = body.split("\n")[0]!.trim();
  const space = firstLine.indexOf(" ");
  const command = space < 0 ? firstLine : firstLine.slice(0, space);
  const rest = space < 0 ? "" : firstLine.slice(space + 1);
  const task = env.AW_TASK ?? "";
  if (body.startsWith("Approved: run it again") && lastDenied) {
    const again = lastDenied;
    lastDenied = null;
    const result = await tool(again.name, again.input, again.run);
    await stop(
      result.ok
        ? `I ran ${again.name} again: ${result.text}.`
        : `${again.name} was denied again: ${result.text}`,
    );
    return true;
  }
  switch (command) {
    case "steps": {
      const lines = body
        .split("\n")
        .slice(1)
        .map((line) => line.trim())
        .filter(Boolean);
      inputs.unshift(...lines);
      await stop(`I run ${lines.length} steps.`);
      return true;
    }
    case "exit":
      await hook("SessionEnd", { reason: "prompt_input_exit" });
      return false;
    case "stop-failure":
      out(`API Error: ${rest || "server_error"}\n\n❯ `);
      await hook("StopFailure", { error: rest || "server_error" });
      return true;
    case "statusline": {
      // The statusLine command of the --settings file, as Claude Code runs it after a turn.
      const settings = args.settings
        ? (JSON.parse(readFileSync(args.settings, "utf8")) as {
            statusLine?: { command?: string };
          })
        : {};
      const command = settings.statusLine?.command;
      const result = command
        ? await execa("sh", ["-c", command], { input: rest, env, reject: false })
        : null;
      await stop(
        `Statusline: ${String(result?.stdout ?? "none")
          .trim()
          .slice(0, 200)}`,
      );
      return true;
    }
    case "reply":
      await stop(rest);
      return true;
    case "message-then-reply": {
      const [message = "", reply = ""] = rest.split(" | ");
      const task = env.AW_TASK ?? "";
      await tool(
        "Bash",
        { command: `aw message ${task} "${message}"`, description: "Run a command" },
        async () => {
          // The plugin bin/ is first in PATH (aw-launch); the text is an argument, not shell text.
          const r = await execa("aw", ["message", task, message], { reject: false, env });
          return (
            `${String(r.stdout ?? "")}${String(r.stderr ?? "")}`.trim() || `(exit ${r.exitCode})`
          );
        },
      );
      await stop(reply.replaceAll("\\n", "\n"));
      return true;
    }
    case "use-credential": {
      const [name = "", size = "40000"] = rest.split(" ");
      const dir = env.AW_CREDENTIALS_DIR ?? "";
      const value = dir && name ? readFileSync(join(dir, name), "utf8").trim() : "";
      if (!value) {
        await stop(`No value for the credential ${name}.`);
        return true;
      }
      const files: Record<string, string | Buffer> = {
        "proposal.md": `# Call the staging API\n\nUse the key ${value} in the header.\n`,
        "notes.txt": `curl -H "Authorization: Bearer ${value}" https://staging.example.com/v1\n`,
        "result.md": `# Result\n\nThe staging call with ${value} passed.\n`,
        "handoff.md": `# Handoff\n\nThe key is ${value}.\n`,
        // A PNG header: these bytes are not UTF-8 and have NUL bytes, so the file is binary.
        "image.bin": Buffer.concat([
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48]),
          Buffer.from(value),
        ]),
        // Text that is not strict UTF-8: one Latin-1 byte, and UTF-16 with a byte order mark.
        "build.log": Buffer.concat([
          Buffer.from(`X-Key: ${value}\ncaf`),
          Buffer.from([0xe9, 0x0a]),
        ]),
        "ps.txt": Buffer.concat([
          Buffer.from([0xff, 0xfe]),
          Buffer.from(`key=${value}\r\n`, "utf16le"),
        ]),
      };
      for (const [file, content] of Object.entries(files)) writeFileSync(join(cwd, file), content);
      const head = `I used the key ${value} for the staging call. `;
      await stop(`${head}${"x".repeat(Math.max(0, Number(size) - head.length))}`);
      return true;
    }
    case "show-credential-wrapped": {
      const [name = "", at = "8"] = rest.split(" ");
      const dir = env.AW_CREDENTIALS_DIR ?? "";
      const value = dir && name ? readFileSync(join(dir, name), "utf8").trim() : "";
      const cut = Number(at);
      out(`● The key is ${value.slice(0, cut)}\n  ${value.slice(cut)} (wrapped).\n`);
      await stop("Shown.");
      return true;
    }
    case "copy-files": {
      const names = readdirSync(rest.trim(), { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name);
      for (const name of names) copyFileSync(join(rest.trim(), name), join(cwd, name));
      await stop(`I copied ${names.join(", ")}.`);
      return true;
    }
    case "wait":
      await new Promise((resolve) => setTimeout(resolve, Number(rest) || 0));
      await stop(`Waited ${rest} ms.`);
      return true;
    case "ask": {
      const { question, options } = questionOf(rest);
      const argv = [
        "ask",
        task,
        question,
        ...(options.length ? ["--options", options.join("|")] : []),
      ];
      const result = await tool(
        "Bash",
        {
          command: `aw ask ${argv
            .slice(1)
            .map((a) => JSON.stringify(a))
            .join(" ")}`,
          description: "Ask the human",
        },
        async () => {
          const r = await execa(awBinary(), argv, { reject: false, env });
          return `${String(r.stdout ?? "")}${String(r.stderr ?? "")} (exit ${r.exitCode})`;
        },
      );
      await stop(
        `I asked the human through aw ask: ${question}. ${result.ok ? "I end my turn now." : result.text}`,
      );
      return true;
    }
    case "ask-tool": {
      const { question, options } = questionOf(rest);
      const result = await tool(
        "AskUserQuestion",
        {
          questions: [
            {
              question,
              header: "Question",
              multiSelect: false,
              options: options.map((label) => ({ label, description: "" })),
            },
          ],
        },
        () => Promise.resolve("No answer"),
      );
      await stop(result.ok ? "The tool gave no answer." : `The tool was denied: ${result.text}`);
      return true;
    }
    case "ask-tool-json": {
      const result = await tool(
        "AskUserQuestion",
        JSON.parse(rest) as Record<string, unknown>,
        () => Promise.resolve("No answer"),
      );
      await stop(result.ok ? "The tool gave no answer." : `The tool was denied: ${result.text}`);
      return true;
    }
    case "plan": {
      const result = await tool("ExitPlanMode", { plan: rest }, () =>
        Promise.resolve("Plan accepted"),
      );
      await stop(result.ok ? "The plan was accepted." : `The plan tool was denied: ${result.text}`);
      return true;
    }
    case "plan-file": {
      const plan = readFileSync(join(cwd, rest.trim()), "utf8");
      const result = await tool("ExitPlanMode", { plan }, () => Promise.resolve("Plan accepted"));
      await stop(result.ok ? "The plan was accepted." : `The plan tool was denied: ${result.text}`);
      return true;
    }
    case "write": {
      const space2 = rest.indexOf(" ");
      const file = space2 < 0 ? rest : rest.slice(0, space2);
      const content = space2 < 0 ? "" : rest.slice(space2 + 1);
      const path = join(cwd, file);
      const result = await tool("Write", { file_path: path, content: `${content}\n` }, () => {
        writeFileSync(path, `${content}\n`);
        return Promise.resolve(`Wrote 1 line to ${file}`);
      });
      await stop(result.ok ? `I wrote ${file}.` : `The Write tool was denied: ${result.text}`);
      return true;
    }
    case "write-then-ask": {
      const space2 = rest.indexOf(" ");
      const file = space2 < 0 ? rest : rest.slice(0, space2);
      const question = space2 < 0 ? "What now?" : rest.slice(space2 + 1);
      const path = join(cwd, file);
      const result = await tool("Write", { file_path: path, content: "x\n" }, () => {
        writeFileSync(path, "x\n");
        return Promise.resolve(`Wrote 1 line to ${file}`);
      });
      await stop(result.ok ? `I wrote ${file}.` : `The Write tool was denied. ${question}`);
      return true;
    }
    case "write-large": {
      const [file = "large.txt", size = "100000"] = rest.split(" ");
      const content = "x".repeat(Number(size));
      const path = join(cwd, file);
      const result = await tool("Write", { file_path: path, content }, () => {
        writeFileSync(path, content);
        return Promise.resolve(`Wrote ${content.length} characters to ${file}`);
      });
      await stop(result.ok ? `I wrote ${file}.` : `The Write tool was denied: ${result.text}`);
      return true;
    }
    case "mcp": {
      const space2 = rest.indexOf(" ");
      const name = space2 < 0 ? rest : rest.slice(0, space2);
      const json = space2 < 0 ? "{}" : rest.slice(space2 + 1);
      const result = await tool(
        `mcp__plugin_aw_aw__${name}`,
        JSON.parse(json) as Record<string, unknown>,
        () => mcpCall(name, JSON.parse(json) as Record<string, unknown>),
      );
      await stop(
        result.ok ? result.text.slice(0, 1500) : `The MCP tool was denied: ${result.text}`,
      );
      return true;
    }
    case "bash": {
      const result = await tool(
        "Bash",
        { command: rest, description: "Run a command" },
        async () => {
          const r = await execa("sh", ["-c", rest], { reject: false, env });
          return (
            `${String(r.stdout ?? "")}${String(r.stderr ?? "")}`.trim() || `(exit ${r.exitCode})`
          );
        },
      );
      await stop(
        result.ok
          ? `The command ended: ${result.text.slice(0, 200)}.`
          : `The Bash tool was denied: ${result.text}`,
      );
      return true;
    }
    default:
      await stop(`Got: ${body.slice(0, 400)}.`);
      return true;
  }
}

async function main(): Promise<void> {
  // The process name of the real Claude Code. Orca knows an agent by it, and then bracket-pastes
  // a text of more than one line as one prompt (add-orca-session-host).
  process.title = "claude";
  const delay = Number(env.FAKE_CLAUDE_START_DELAY_MS ?? 0);
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", onData);
  out("\u001b[?2004h");
  out(` ✻ Claude Code (fake) · session ${args.name ?? sessionId}\n`);
  const exitOnce = env.FAKE_CLAUDE_EXIT_ONCE;
  if (exitOnce && !existsSync(exitOnce)) {
    writeFileSync(exitOnce, `${process.pid}\n`);
    out("Fake start failure before SessionStart\n");
    process.exit(1);
  }
  if (!trusted()) await trustScreen();
  if (
    args.permissionMode === "bypassPermissions" &&
    settingsFile().skipDangerousModePermissionPrompt !== true
  ) {
    // The warning dialog of Claude Code (spike S2): it blocks the start; the fake never goes on.
    out(
      "\n WARNING: Claude Code running in Bypass Permissions mode\n ❯ 1. No, exit\n   2. Yes, I accept\n\n Enter to confirm · Esc to cancel\n",
    );
    await new Promise(() => undefined);
  }
  const start = specific(
    await hook(`SessionStart.${args.resume ? "resume" : "startup"}`, {
      source: args.resume ? "resume" : "startup",
      session_title: args.name ?? undefined,
    }),
  );
  const context = typeof start.additionalContext === "string" ? start.additionalContext : "";
  record("system", { context_chars: context.length });
  if (env.FAKE_CLAUDE_EXIT_AFTER_START === "1") {
    out("Fake crash after SessionStart\n");
    process.exit(1);
  }
  out(` SessionStart context: ${context.length} characters\n`);
  if (args.message !== null && args.message.length > 0) inputs.push(args.message);
  out("❯ ");
  for (;;) {
    const next = inputs.shift();
    if (next === undefined) {
      await new Promise<void>((resolve) => (wakeTurn = resolve));
      wakeTurn = null;
      continue;
    }
    if (!(await turn(next))) break;
  }
  process.exit(0);
}

void main();
