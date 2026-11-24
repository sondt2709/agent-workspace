// Plain types of the setup check `GET /v1/doctor` (openspec gap-install, setup-check). The zod
// schema in doctor.ts is the source. This file has no import, so the desktop renderer type-checks it
// without Node types (the same reason as types.ts and views.ts).

export type DoctorStatus = "ok" | "warn" | "fail" | "skip";

export interface DoctorCheck {
  /** For example `service`, `claude_login` or `device:ubuntu-01`. */
  id: string;
  title: string;
  status: DoctorStatus;
  detail: string;
  /** What the person does to fix it; null for `ok` and `skip`. */
  fix: string | null;
}

export interface DoctorReply {
  device: string;
  /** False when one check has the status `fail`. */
  ok: boolean;
  checks: DoctorCheck[];
}
