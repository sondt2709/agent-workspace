#!/usr/bin/env node
// The engine script (docs/tech-stack.md 1.2):
//   node scripts/engine.ts fetch [--platform <os-arch>] [--dest <folder>]
//   node scripts/engine.ts verify-pins
// fetch downloads the pinned archive, checks its sha256 and writes <dest>/syncthing.
// verify-pins checks the pins against the signed release sums (CI step, needs network and gpg).
import {
  ensureTestEngine,
  fetchEngine,
  loadPins,
  platformKey,
  PLATFORMS,
  verifyPins,
  type EnginePlatform,
} from "../src/pins.ts";

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

async function main(args: string[]): Promise<void> {
  const command = args[0];
  const pins = await loadPins();
  if (command === "verify-pins") {
    await verifyPins(pins);
    process.stdout.write(`The pins of ${pins.tag} match the signed release sums.\n`);
    return;
  }
  if (command === "fetch") {
    const dest = option(args, "--dest");
    const platform = option(args, "--platform") ?? platformKey();
    if (!platform || !(PLATFORMS as readonly string[]).includes(platform)) {
      throw new Error(`Give --platform, one of ${PLATFORMS.join(", ")}`);
    }
    const binary = dest
      ? await fetchEngine({ pins, platform: platform as EnginePlatform, dest })
      : await ensureTestEngine(platform as EnginePlatform);
    process.stdout.write(`${binary}\n`);
    return;
  }
  throw new Error("Usage: engine.ts fetch [--platform <os-arch>] [--dest <folder>] | verify-pins");
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exit(1);
});
