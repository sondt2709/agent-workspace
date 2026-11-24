// The setup check route (openspec gap-install, setup-check): `GET /v1/doctor`, a person route. awd
// checks its reply with this schema and generates contracts/openapi.yaml from it. The plain types
// are in doctor-types.ts.
import { z } from "zod";
import type { DoctorReply } from "./doctor-types.ts";
import type { AwClient } from "./index.ts";

export type * from "./doctor-types.ts";

export const doctorStatus = z.enum(["ok", "warn", "fail", "skip"]).meta({ id: "DoctorStatus" });

export const doctorCheck = z
  .object({
    id: z.string().describe("For example `service`, `claude_login` or `device:ubuntu-01`"),
    title: z.string(),
    status: doctorStatus,
    detail: z.string(),
    fix: z.string().nullable().describe("What the person does to fix it; null for ok and skip"),
  })
  .meta({ id: "DoctorCheck" });

export const doctorReply = z
  .looseObject({
    device: z.string(),
    ok: z.boolean().describe("False when one check has the status fail"),
    checks: z.array(doctorCheck),
  })
  .meta({ id: "Doctor" });

export class DoctorClient {
  readonly #client: AwClient;

  constructor(client: AwClient) {
    this.#client = client;
  }

  /** Runs the setup check of this device in awd. */
  doctor = () => this.#client.request<DoctorReply>("GET", "/v1/doctor", doctorReply);
}
