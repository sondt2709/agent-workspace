// End-to-end test of the redaction of agent files (openspec credential-redaction, gap M13) with tmux
// and the fake agent: the agent writes a credential value in a long reply, approach versions,
// copied text files, a result, a handoff and a binary file. No synced file has the value or the
// session token; the binary keeps its bytes, and artifact.added has the sha256 of the file on disk.
import type { EventRow } from "@aw/core";
import { newId } from "@aw/schema";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sessionPaths } from "../sessions/records.ts";
import { writeSpool } from "../sessions/spool.ts";
import {
  startSessionDaemon,
  TEST_TMUX,
  waitFor,
  type SessionTestDaemon,
} from "../sessions/testing.ts";

let awd: SessionTestDaemon | null = null;

afterEach(async () => {
  await awd?.close();
  awd = null;
});

const data = (row: EventRow) => (row.event as { data: Record<string, unknown> }).data;
const text = (row: EventRow) =>
  typeof data(row).text === "string" ? (data(row).text as string) : "";
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** Each file of a folder, recursive, as a path relative to the folder. */
async function filesOf(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return (
    entries
      // A temp file of an atomic write (`*.aw-tmp`) can go before the read.
      .filter((e) => e.isFile() && !e.name.endsWith(".aw-tmp"))
      .map((e) => relative(root, join(e.parentPath, e.name)))
      .sort()
  );
}

const VALUE = "stg_live_9f8e7d6c5b4a_e2e";
const MARKER = "[redacted:staging-api-key]";

describe.skipIf(!TEST_TMUX)("redaction of agent files", () => {
  it("redacts the long reply, the approach versions, the copied text files and the token, and keeps a binary", async () => {
    awd = await startSessionDaemon();
    const added = await awd.aw(["credential", "add", "staging-api-key"], {
      stdin: () => Promise.resolve(`${VALUE}\n`),
    });
    expect(added.code).toBe(0);
    const created = await awd.client.createTask("-", {
      project: "billing-api",
      title: "Call the staging API",
      first_message: "use-credential staging-api-key 40000",
      assignee: "claude@macbook-pro",
      credentials: ["staging-api-key"],
    });
    const task = created.task.id;
    const folder = join(awd.folder, "tasks", task);

    // 1. The long reply: the event keeps a preview, and the full text goes to a text file.
    const reply = await awd.waitRow(
      task,
      (r) => r.type === "message.agent" && text(r).includes("[AW: the full text"),
      30_000,
    );
    expect(text(reply)).toContain(MARKER);
    const longFile = /is in (artifacts\/macbook-pro\/text-[0-9a-f-]+\.md)\]/.exec(text(reply))![1]!;
    const long = await readFile(join(folder, longFile), "utf8");
    expect(long.startsWith(`I used the key ${MARKER} for the staging call.`)).toBe(true);

    // 2. The agent commands of the CLI copy or write its files.
    const session = awd.session(task);
    const env = await awd.agentEnv(task);
    const cwd = awd.worktree(task);
    expect(await readFile(join(cwd, "notes.txt"), "utf8")).toContain(VALUE);
    const run = async (args: string[]) => {
      const result = await awd!.aw(args, { env, cwd });
      expect(result.code, `aw ${args.join(" ")}: ${result.stderr}`).toBe(0);
    };
    await run(["approach", task, "--file", "approach.md"]);
    await run(["artifact", "add", task, "notes.txt"]);
    // Text that is not strict UTF-8 is redacted in its bytes (fix list 0-42).
    await run(["artifact", "add", task, "build.log"]);
    await run(["artifact", "add", task, "ps.txt"]);
    await run(["handoff", task, "--file", "handoff.md"]);
    await run(["result", task, "--file", "result.md", "--artifact", "image.bin"]);
    const result = await awd.waitRow(
      task,
      (r) => r.type === "gate.opened" && data(r).kind === "approve_result",
    );
    expect(text(result)).toContain(MARKER);
    expect(text(result)).not.toContain(VALUE);

    // 3. Plans of the ExitPlanMode hook with the value. The same text as v1 compares the redacted
    // version file and writes no new version; a new text writes a redacted v2.
    const plans = (rows: EventRow[]) =>
      rows
        .filter((r) => r.type === "gate.opened" && data(r).kind === "confirm_approach")
        .map((r) => String(data(r).file));
    await awd.sendMessage("pixel-9", task, session, "plan-file approach.md");
    await waitFor(async () => plans(await awd!.rows(task)).length === 2, 15_000);
    await awd.sendMessage("pixel-9", task, session, "plan-file notes.txt");
    await waitFor(async () => plans(await awd!.rows(task)).length === 3, 15_000);
    expect(plans(await awd.rows(task))).toEqual([
      "approach/v1.md",
      "approach/v1.md",
      "approach/v2.md",
    ]);
    expect(await readFile(join(folder, "approach", "v2.md"), "utf8")).toBe(
      `curl -H "Authorization: Bearer ${MARKER}" https://staging.example.com/v1\n`,
    );

    // 4. A long message with the session token.
    const token = await awd.token(session);
    const agent = await awd.agentClient(session);
    await agent.agentMessage(session, { task, text: `token ${token} ${"y".repeat(40_000)}` });
    const tokenRow = await awd.waitRow(
      task,
      (r) => r.type === "message.agent" && text(r).startsWith("token "),
    );
    const tokenFile = /is in (artifacts\/macbook-pro\/text-[0-9a-f-]+\.md)\]/.exec(
      text(tokenRow),
    )![1]!;
    expect(await readFile(join(folder, tokenFile), "utf8")).toMatch(
      /^token \[redacted:mcp-token\] y+$/,
    );

    // 5. Each text file of the task has the marker; the binary keeps its bytes.
    await waitFor(
      async () =>
        (await awd!.rows(task)).filter((r) => r.type === "artifact.added").length === 4 &&
        (await awd!.rows(task)).some((r) => r.type === "handoff.written"),
      15_000,
    );
    const files = await filesOf(folder);
    const marked: string[] = [];
    for (const file of files) {
      if (file.startsWith("log/") || file.endsWith(".yaml") || file.endsWith("image.bin")) continue;
      if (file.endsWith("ps.txt")) {
        const utf16 = await readFile(join(folder, file));
        expect(utf16.includes(Buffer.from(VALUE, "utf16le"))).toBe(false);
        expect(utf16.includes(Buffer.from(MARKER, "utf16le"))).toBe(true);
        continue;
      }
      // The terminal snapshot (openspec task-terminal-view) has the marker only when the screen
      // shows the value at its capture time: it has its own test. It never has the value.
      if (file.startsWith("terminal/")) {
        expect(await readFile(join(folder, file), "utf8")).not.toContain(VALUE);
        continue;
      }
      const content = await readFile(join(folder, file), "utf8").catch(() => "");
      if (content.includes(MARKER))
        marked.push(file.replace(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|\d{8}T\d{6}/g, "*"));
    }
    expect(marked.sort()).toEqual(
      [
        "approach/v1.md",
        "approach/v2.md",
        "artifacts/macbook-pro/build.log",
        "artifacts/macbook-pro/handoff-*.md",
        "artifacts/macbook-pro/notes.txt",
        "artifacts/macbook-pro/result-*.md",
        "artifacts/macbook-pro/text-*.md",
      ].sort(),
    );
    const image = await readFile(join(folder, "artifacts", "macbook-pro", "image.bin"));
    expect(image.equals(await readFile(join(cwd, "image.bin")))).toBe(true);
    expect(image.includes(Buffer.from(VALUE))).toBe(true);

    // artifact.added describes the file on disk: the redacted text and the binary.
    for (const row of (await awd.rows(task)).filter((r) => r.type === "artifact.added")) {
      const disk = await readFile(join(folder, String(data(row).path)));
      expect(data(row)).toMatchObject({ size: disk.length, sha256: sha256(disk) });
    }

    // 6. The title of an AskUserQuestion gate is cut at 500 characters after the redaction: a value
    // across the cut keeps no prefix (fix list 0-41). The hook spool file is the one of the agent.
    const at = Date.now();
    const askGate = newId({ now: () => at });
    await writeSpool(
      sessionPaths(awd.home, session).spool,
      {
        event: "PreToolUse",
        at,
        payload: {
          hook_event_name: "PreToolUse",
          tool_name: "AskUserQuestion",
          tool_input: {
            questions: [
              {
                question: `${"q".repeat(490)}${VALUE} end?`,
                header: `${"h".repeat(95)}${VALUE}`,
                options: [{ label: "Use it", description: `${"d".repeat(1995)}${VALUE}` }],
              },
            ],
          },
          tool_use_id: `toolu_${at}`,
        },
        gate: askGate,
      },
      at * 1000,
    );
    const asked = await awd.waitRow(
      task,
      (r) => r.type === "gate.opened" && data(r).gate === askGate,
      15_000,
    );
    expect(data(asked).title).toBe(`${"q".repeat(490)}${MARKER}`.slice(0, 500));
    expect(JSON.stringify(data(asked))).not.toContain(VALUE.slice(0, 9));
    // The header and the description of a question are redacted before their cuts (gate-context).
    const question = (
      data(asked).questions as { header: string; options: { description: string }[] }[]
    )[0]!;
    expect(question.header).toBe(`${"h".repeat(95)}${MARKER}`.slice(0, 100));
    expect(question.options[0]!.description).toBe(`${"d".repeat(1995)}${MARKER}`.slice(0, 2000));
    // The details of aw ask and the long-details file are redacted (gate-context).
    const io = { env: await awd.agentEnv(task) };
    const details = await awd.aw(
      ["ask", task, "Which key?", "--details", `${"x".repeat(17_000)}${VALUE}`],
      io,
    );
    expect(details.code).toBe(0);
    const detailsGate = /gate ([0-9a-f-]{36})/.exec(details.stdout)![1]!;
    const detailsRow = await awd.waitRow(
      task,
      (r) => r.type === "gate.opened" && data(r).gate === detailsGate,
    );
    expect(JSON.stringify(data(detailsRow))).not.toContain(VALUE.slice(0, 9));
    expect(await readFile(join(folder, String(data(detailsRow).file)), "utf8")).toBe(
      `${"x".repeat(17_000)}${MARKER}`,
    );

    // 7. No file of the workspace folder (except the binary) and no log line has the value or
    // the token.
    const leaks: string[] = [];
    for (const file of await filesOf(awd.folder)) {
      if (file.endsWith("image.bin")) continue;
      const content = await readFile(join(awd.folder, file)).catch(() => Buffer.alloc(0));
      if (content.includes(VALUE) || content.includes(token)) leaks.push(file);
    }
    expect(leaks, JSON.stringify(leaks)).toEqual([]);
    const logs = JSON.stringify(awd.logLines());
    expect(logs.length).toBeGreaterThan(100);
    expect(logs).not.toContain(VALUE);
    expect(logs).not.toContain(token);
  }, 90_000);
});
