// aw-hook as a process (openspec session-options): the AW guard answers Claude Code also when the
// spool of the session cannot be written (review finding of check soc-11).
import { execa } from "execa";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { tempDir } from "../testing.ts";

const HOOK = fileURLToPath(new URL("./aw-hook.ts", import.meta.url));

async function runHook(home: string, payload: unknown) {
  return execa(process.execPath, [HOOK, "PreToolUse"], {
    input: JSON.stringify(payload),
    reject: false,
    env: { AW_HOME: home, HOME: home, AW_SESSION: "s1" },
    extendEnv: false,
  });
}

const wrapped = {
  session_id: "00000000-0000-4000-8000-000000000001",
  hook_event_name: "PreToolUse",
  tool_name: "Bash",
  tool_input: { command: 'sh -c "aw gate answer g3 yes"' },
  tool_use_id: "toolu_01",
};

describe("aw-hook PreToolUse", () => {
  it("denies a person command, also when the spool cannot be written", async () => {
    const home = await tempDir("aw-hook-");
    const spool = join(home, "sessions", "s1", "spool");
    await mkdir(spool, { recursive: true });
    const ok = await runHook(home, wrapped);
    expect(ok.stdout).toContain('"permissionDecision":"deny"');
    // A file in place of the spool folder: the write fails.
    const broken = await tempDir("aw-hook-");
    await mkdir(join(broken, "sessions", "s1"), { recursive: true });
    await writeFile(join(broken, "sessions", "s1", "spool"), "not a folder");
    const result = await runHook(broken, wrapped);
    expect(result.stdout).toContain('"permissionDecision":"deny"');
    expect(result.stdout).toContain("AW denied this tool call");
  });
});
