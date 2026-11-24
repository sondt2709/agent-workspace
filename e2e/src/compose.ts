// The harness of the Docker suite: docker compose commands for the 2 devices of e2e/compose.yaml.
// Later e2e tasks reuse it (task-loop, e2e-real).
import { execa } from "execa";
import { fileURLToPath } from "node:url";
import { loadE2eSettings } from "./settings.ts";

export const COMPOSE_FILE = fileURLToPath(new URL("../compose.yaml", import.meta.url));
/** The compose project name (`AW_E2E_PROJECT`, see settings.ts). */
export const PROJECT = loadE2eSettings().project;
export const DEVICES = ["macbook-pro", "ubuntu-01"] as const;
export type Device = (typeof DEVICES)[number];

/** The workspace folder in each container. */
export const WORKSPACE = "/aw/ws";

/**
 * Engine log lines of third-party traffic. The patterns come from the engine log of the
 * verification on 2026-11-22 with the default config: "global discovery server", "Joined relay",
 * "Relay listener", "Detected NAT", "New external port opened" (UPnP, NAT-PMP).
 */
export const LEAK_LINE =
  /global discovery|discovery\.syncthing|relay|\bnat\b|upnp|nat-pmp|external port|stun|usage report|crash report|data\.syncthing/i;

/** The lines of an engine log that show third-party traffic. */
export function leakLines(log: string): string[] {
  return log.split("\n").filter((line) => LEAK_LINE.test(line));
}

/** The arguments of `docker compose` for this project. */
export function composeArgs(...args: string[]): string[] {
  return ["compose", "-f", COMPOSE_FILE, "-p", PROJECT, ...args];
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs `docker compose <args>`. */
export async function compose(args: string[], input?: string | Uint8Array): Promise<RunResult> {
  const result = await execa("docker", composeArgs(...args), {
    reject: false,
    // Keep the bytes of a file as they are: "one\n" stays "one\n".
    stripFinalNewline: false,
    ...(input === undefined ? {} : { input }),
  });
  return { code: result.exitCode ?? 1, stdout: result.stdout, stderr: result.stderr };
}

/** Runs a command in a device container (exec-form arguments, no shell string). */
export function exec(
  device: Device,
  command: string[],
  input?: string | Uint8Array,
): Promise<RunResult> {
  return compose(["exec", "-T", device, ...command], input);
}

/** Runs `aw <args>` in a device container. */
export function aw(device: Device, args: string[]): Promise<RunResult> {
  return exec(device, ["aw", ...args]);
}

/** Runs `aw <args> --json` and parses the reply. Throws with the output when aw fails. */
export async function awJson<T>(device: Device, args: string[], okCodes = [0]): Promise<T> {
  const result = await aw(device, ["--json", ...args]);
  if (!okCodes.includes(result.code)) {
    throw new Error(`aw ${args.join(" ")} on ${device} gave ${result.code}: ${result.stderr}`);
  }
  return JSON.parse(result.stdout) as T;
}

/** Copies files from one container to another with tar (no host path). */
export async function copyBetween(
  from: Device,
  to: Device,
  dir: string,
  paths: string[],
): Promise<void> {
  const packed = await execa(
    "docker",
    composeArgs("exec", "-T", from, "tar", "-C", dir, "-cf", "-", ...paths),
    {
      encoding: "buffer",
    },
  );
  const unpacked = await exec(to, ["tar", "-C", dir, "-xf", "-"], packed.stdout);
  if (unpacked.code !== 0) throw new Error(`tar on ${to} failed: ${unpacked.stderr}`);
}

/** Waits until the check returns a value that is not false, null or undefined. */
export async function waitFor<T>(
  check: () => Promise<T | null | undefined | false>,
  timeoutMs: number,
  what: string,
  stepMs = 250,
): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await check().catch(() => null);
    if (value !== null && value !== undefined && value !== false) return value;
    if (Date.now() > until) throw new Error(`Timed out after ${timeoutMs} ms: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
}
