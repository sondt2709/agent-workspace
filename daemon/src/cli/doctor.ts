// `aw doctor` (openspec gap-install, setup-check): the setup check of this device. It asks awd
// (`GET /v1/doctor`); when awd does not answer it runs the local checks and adds a failed `awd`
// check. Exit code 1 when a check failed.
import { AwUnreachableError, type AwClient } from "@aw/client";
import { DoctorClient, type DoctorCheck, type DoctorReply } from "@aw/client/doctor";
import type { Command } from "@commander-js/extra-typings";
import { localProbes, runDoctor, type DoctorProbes } from "../service/doctor.ts";
import type { Settings } from "../settings.ts";

const MARK: Record<DoctorCheck["status"], string> = {
  ok: "ok  ",
  warn: "warn",
  fail: "FAIL",
  skip: "skip",
};

export function formatDoctor(reply: DoctorReply): string {
  const lines = [`Setup check of ${reply.device}`];
  for (const check of reply.checks) {
    lines.push(`[${MARK[check.status]}] ${check.title}: ${check.detail}`);
    if (check.fix) lines.push(`       Fix: ${check.fix}`);
  }
  const failed = reply.checks.filter((c) => c.status === "fail").length;
  const warned = reply.checks.filter((c) => c.status === "warn").length;
  lines.push(
    failed === 0 && warned === 0
      ? "All checks passed."
      : `${failed} failed, ${warned} with a warning.`,
  );
  return lines.join("\n");
}

export interface DoctorCommandContext {
  settings: Settings;
  client: AwClient;
  platform: NodeJS.Platform;
  uid: number;
  print: (value: unknown, text: () => string) => void;
  failed: () => void;
  /** The probes of the local check; tests give fakes. */
  probes?: DoctorProbes;
}

export function addDoctorCommand(program: Command, ctx: DoctorCommandContext): void {
  program
    .command("doctor")
    .description(
      "Check the setup of this device: service, session host, Claude sign-in, disk, clock, sync engine and the other devices",
    )
    .action(async () => {
      let reply: DoctorReply;
      try {
        reply = await new DoctorClient(ctx.client).doctor();
      } catch (error) {
        if (!(error instanceof AwUnreachableError)) throw error;
        const local = await runDoctor(
          ctx.probes ?? localProbes(ctx.settings, ctx.platform, ctx.uid),
        );
        const awd: DoctorCheck = {
          id: "awd",
          title: "awd",
          status: "fail",
          detail: `awd does not answer on ${ctx.settings.socketPath}.`,
          fix: "Run aw service install, or run awd in a terminal.",
        };
        reply = { ...local, ok: false, checks: [awd, ...local.checks] };
      }
      ctx.print(reply, () => formatDoctor(reply));
      if (!reply.ok) ctx.failed();
    });
}
