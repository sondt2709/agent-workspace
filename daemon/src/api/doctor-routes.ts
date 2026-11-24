// The setup check route (openspec gap-install, setup-check): `GET /v1/doctor`, a person route. A
// thin adapter: it runs the checks of service/doctor.ts with the probes of awd.
import { doctorReply } from "@aw/client/doctor";
import { errorReplies } from "@aw/client/schemas";
import type { Daemon } from "../service/daemon.ts";
import { daemonProbes, runDoctor, type DoctorProbes } from "../service/doctor.ts";
import type { ZodApi } from "./knowledge.ts";

export function registerDoctorRoutes(
  api: ZodApi,
  daemon: Daemon,
  probes: (daemon: Daemon) => DoctorProbes = daemonProbes,
): void {
  api.get(
    "/v1/doctor",
    {
      config: { access: "person" },
      schema: {
        tags: ["probes"],
        operationId: "getDoctor",
        summary:
          "The setup check of this device: service, session host, Claude sign-in, disk, clock, sync engine, reach of each device, and the macOS power checks",
        response: { 200: doctorReply, ...errorReplies },
      },
    },
    async () => (await runDoctor(probes(daemon))) as never,
  );
}
