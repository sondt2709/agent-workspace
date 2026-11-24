#!/usr/bin/env node
// aw-statusline: the statusLine command of an AW session (docs/architecture.md 4.6.6, design of
// add-continuity decision 9). It writes the usage windows of its input to `usage.json` of the session
// when they changed (awd reads the file), then runs the user's own statusline command with the same
// input and prints its output. It never fails the statusline of the user.
import { systemClock } from "@aw/core";
import { execa } from "execa";
import { readFile, rename, writeFile } from "node:fs/promises";
import { makeAdapter } from "../sessions/plugins.ts";
import { sessionPaths } from "../sessions/records.ts";
import { loadSettings } from "../settings.ts";

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
const raw = Buffer.concat(chunks).toString("utf8");

const settings = loadSettings();
const session = settings.sessions.session;
if (session && /^[0-9a-f-]{36}$/.test(session.id)) {
  try {
    const signal = makeAdapter(settings).parseStatusLine?.(JSON.parse(raw)) ?? null;
    if (signal !== null) {
      const path = sessionPaths(settings.home, session.id).usage;
      const body = { five_hour: signal.five_hour, seven_day: signal.seven_day };
      const old = await readFile(path, "utf8").catch(() => "");
      let same = false;
      try {
        const parsed = JSON.parse(old) as Record<string, unknown>;
        same =
          JSON.stringify({ five_hour: parsed.five_hour, seven_day: parsed.seven_day }) ===
          JSON.stringify(body);
      } catch {
        same = false;
      }
      if (!same) {
        const temp = `${path}.${process.pid}.tmp`;
        await writeFile(temp, JSON.stringify({ ...body, at: systemClock.now() }), { mode: 0o600 });
        await rename(temp, path);
      }
    }
  } catch {
    // A statusline input that does not parse changes nothing.
  }
}

const user = process.env.AW_USER_STATUSLINE;
if (user) {
  const result = await execa("sh", ["-c", user], { input: raw, reject: false, timeout: 5000 });
  process.stdout.write(String(result.stdout ?? ""));
}
