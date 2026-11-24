#!/usr/bin/env node
// The aw CLI. All logic is in cli/run.ts, so tests call run(argv, io) in process.
import { run } from "../cli/run.ts";

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
};

process.exitCode = await run(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  stdin: readStdin,
});
