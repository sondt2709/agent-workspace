// Document schemas: one YAML file each, with `kind` and `schema` (docs/phase-1.md 3.1 and 3.2).
// Objects are loose: a reader keeps the fields of a newer minor version (design decision 3).
import { z } from "zod";
import {
  agentRef,
  count,
  deviceRole,
  deviceSlug,
  entryName,
  hlcText,
  isoTime,
  keyPrefix,
  pauseCause,
  permissionMode,
  projectSlug,
  sessionHost,
  stage,
  taskKey,
  uuidv7,
} from "./common.ts";

/** `tasks/workspace.yaml`: a shared file. */
export const workspaceV1 = z.looseObject({
  kind: z.literal("workspace"),
  schema: z.literal(1),
  id: uuidv7,
  name: z.string().min(1).max(200),
  key_prefix: keyPrefix,
  /** Priority order of the devices; the default is the pairing order (device-sync decision 5). */
  device_order: z.array(deviceSlug).default([]),
  switches: z
    .looseObject({
      /** "Use community discovery and relay servers" (docs/phase-1.md 6.2). */
      community_relays: z.boolean().default(true),
    })
    .default({ community_relays: true }),
  /**
   * The `permission_mode` of a new project when the add sets none (openspec permissions-default).
   * Only a person sets it: a person route and a person command write it. A missing value is `skip`:
   * the product default (decision 38, openspec polish-skip-default).
   */
  new_project_permission_mode: permissionMode.default("skip"),
});
export type WorkspaceDocument = z.infer<typeof workspaceV1>;

/** `tasks/projects/<project>/project.yaml`: a shared file. */
export const projectV1 = z.looseObject({
  kind: z.literal("project"),
  schema: z.literal(1),
  slug: projectSlug,
  name: z.string().min(1).max(200),
  /** Ordered list of the devices that implement (device-sync decision 3). */
  devices: z.array(deviceSlug).default([]),
  /** The agent of new tasks, for example `claude`. */
  default_agent: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/)
    .default("claude"),
  /** Test server names. The phone reads them here, because it has no `secure` folder. */
  test_servers: z.array(entryName).default([]),
  links: z.array(z.string().min(1)).default([]),
  /** The main repository of the project (prd WS-07). It is one of `links`. */
  main_repo: z.string().min(1).nullable().default(null),
  switches: z
    .looseObject({
      /** "Assign new subtasks to the default device", off by default (task-model §5.1). */
      assign_new_subtasks_to_default_device: z.boolean().default(false),
    })
    .default({ assign_new_subtasks_to_default_device: false }),
  /**
   * An archived project gets no new tasks. AW never deletes a project folder (gap-setup), also at a
   * remove (`project.removed`, openspec project-remove).
   */
  archived: z.boolean().default(false),
  /**
   * The HLC of the add (openspec project-remove). The project is live when it sorts after the
   * newest `project.removed` of its slug. Null: an older file, added before each remove.
   */
  added_at: hlcText.nullable().default(null),
  /**
   * The permission mode of new sessions when the task sets none (openspec session-options). A
   * `skip` default counts only for a task that a person created. A missing value is `skip`, the
   * product default (openspec polish-skip-default).
   */
  permission_mode: permissionMode.default("skip"),
});
export type ProjectDocument = z.infer<typeof projectV1>;

/** The pause state on top of a stage (docs/architecture.md 4.6.5). */
export const pauseState = z.looseObject({
  cause: pauseCause,
  since: isoTime,
  resumes_at: isoTime.nullable().default(null),
  next_step: z.string().min(1),
  needs_human: z.boolean(),
});

/** `tasks/<task-id>/task.yaml`: the snapshot that the owner device writes (docs/phase-1.md 3.2). */
export const taskV1 = z.looseObject({
  kind: z.literal("task"),
  schema: z.literal(1),
  /** The internal id and the folder name. */
  id: uuidv7,
  /** The display alias (docs/phase-1.md 3.6). */
  key: taskKey,
  project: projectSlug,
  title: z.string().min(1).max(500),
  /** The raw first input of the agent. AW passes it as is. */
  first_message: z.string(),
  stage,
  /** Open gate ids: the "Needs you" lane. */
  needs_you: z.array(uuidv7).default([]),
  paused: pauseState.nullable().default(null),
  assignee: agentRef.nullable().default(null),
  claim: z
    .looseObject({ epoch: z.int().min(1), device: deviceSlug, session: uuidv7 })
    .nullable()
    .default(null),
  proposal: z
    .looseObject({ latest: count, approved: z.int().min(1).nullable() })
    .default({ latest: 0, approved: null }),
  ready: z
    .looseObject({ passed_on: deviceSlug.nullable(), missing: z.array(z.string()) })
    .nullable()
    .default(null),
  /** A name in `secure/test-servers.yaml`. */
  test_server: entryName.nullable().default(null),
  /** Credential names only, never values. */
  credentials: z.array(entryName).default([]),
  parent: uuidv7.nullable().default(null),
  subtasks: z.array(uuidv7).default([]),
  depends_on: z.array(uuidv7).default([]),
  links: z.array(z.string().min(1)).default([]),
  /** The checkpoint branch, fixed at the first session, for example `aw/AW-7`. */
  branch: z.string().min(1).nullable().default(null),
  /** The count of log lines of each device that this snapshot includes. */
  includes: z.record(deviceSlug, count).default({}),
  /** AW never deletes a task folder (docs/architecture.md 4.3.4). */
  archived: z.boolean().default(false),
});
export type TaskDocument = z.infer<typeof taskV1>;

/** `tasks/devices/<device>/device.yaml`: the signed device record (docs/architecture.md 4.1). */
export const deviceV1 = z.looseObject({
  kind: z.literal("device"),
  schema: z.literal(1),
  slug: deviceSlug,
  name: z.string().min(1).max(200),
  role: deviceRole,
  keys: z.looseObject({
    /** Ed25519 public key, base64. */
    ed25519: z.base64(),
    /** X25519 public key, base64. */
    x25519: z.base64(),
  }),
  /** The Syncthing device id: 8 groups of 7 base32 characters. */
  sync_device_id: z.string().regex(/^[A-Z2-7]{7}(?:-[A-Z2-7]{7}){7}$/),
  /** A reader accepts only the highest sequence number with a valid signature. */
  seq: z.int().min(1),
  revoked: z.boolean().default(false),
  /**
   * The HLC of the revoke on the device with the master key. The merge ignores each event of the
   * device that sorts after it (openspec add-identity-and-pairing, design decision 8).
   */
  revoked_at: hlcText.nullable().default(null),
  /** The engine addresses at pairing, for example `tcp://192.0.2.10:22300`. Peers add `dynamic`. */
  addresses: z.array(z.string().min(1)).max(16).default([]),
  paired_at: isoTime,
  /** The master-key signature (Ed25519, base64) over the record as written (`@aw/identity`). */
  signature: z.base64(),
});
export type DeviceDocument = z.infer<typeof deviceV1>;

const usageWindow = z.looseObject({
  used_percentage: z.number().min(0).max(100),
  resets_at: isoTime.nullable(),
});

/** `tasks/devices/<device>/health.yaml`: at most once per 60 s (docs/architecture.md 4.6.12). */
export const healthV1 = z.looseObject({
  kind: z.literal("health"),
  schema: z.literal(1),
  device: deviceSlug,
  updated: hlcText,
  boot_time: isoTime,
  versions: z.record(z.string().min(1), z.string().min(1)).default({}),
  sessions: z
    .array(
      z.looseObject({
        session: uuidv7,
        task: uuidv7,
        state: z.enum(["running", "gate", "paused", "ended"]),
      }),
    )
    .default([]),
  usage: z
    .array(
      z.looseObject({
        login: z.string().min(1),
        five_hour: usageWindow.nullable().default(null),
        seven_day: usageWindow.nullable().default(null),
        login_expires_at: isoTime.nullable().default(null),
      }),
    )
    .default([]),
  disk: z.looseObject({ used_percentage: z.number().min(0).max(100) }),
  /**
   * The limits of the agent queue of this device (openspec queue-and-assign): `AW_MAX_WORKING`,
   * `AW_DISK_FULL_PERCENT` and the sign-in state (null when not known). Other devices and the
   * phone read them for the cause of a queued task. Absent in files of an older awd.
   */
  queue: z
    .looseObject({
      max_working: z.int().min(1).max(999),
      disk_full_percent: z.number().min(1).max(100),
      login_valid: z.boolean().nullable(),
    })
    .optional(),
  sync: z
    .array(
      z.looseObject({
        peer: deviceSlug,
        connected: z.boolean(),
        last_seen: isoTime.nullable().default(null),
        route: z.enum(["lan", "tailscale", "relay", "unknown"]).default("unknown"),
        need_items: count.default(0),
        need_bytes: count.default(0),
        errors: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  /** Each repair of a file (docs/phase-1.md 6.6.4). */
  repairs: z
    .array(z.looseObject({ at: isoTime, path: z.string().min(1), text: z.string() }))
    .default([]),
});
export type HealthDocument = z.infer<typeof healthV1>;

/** An uncompressed P-256 public key, base64url with no padding: 65 bytes, 87 characters. */
export const vapidKey = z.string().regex(/^B[A-Za-z0-9_-]{86}$/);
const base64url = z.string().regex(/^[A-Za-z0-9_-]+$/);

/** `tasks/devices/<phone>/push.yaml`: the push endpoints of a phone (docs/phase-1.md 8.2). */
export const pushV1 = z.looseObject({
  kind: z.literal("push"),
  schema: z.literal(1),
  device: deviceSlug,
  subscriptions: z
    .array(
      z.looseObject({
        /** The computer that sends to this endpoint. */
        computer: deviceSlug,
        endpoint: z
          .string()
          .max(4096)
          .regex(/^https?:\/\/\S+$/),
        /** The RFC 8291 public key of the phone (uncompressed P-256). */
        p256dh: vapidKey,
        /** The RFC 8291 auth secret (16 bytes). */
        auth: base64url.min(16).max(32),
        /** The key that the instance was registered with. */
        vapid_public_key: vapidKey,
        distributor: z.string().min(1).nullable().default(null),
        updated: z.string().default(""),
      }),
    )
    .default([]),
});
export type PushDocument = z.infer<typeof pushV1>;

/** `tasks/devices/<device>/bindings.yaml`: checkouts, plugins, skills and "may run". */
export const bindingsV1 = z.looseObject({
  kind: z.literal("bindings"),
  schema: z.literal(1),
  device: deviceSlug,
  /** True when this device may run agents. A mobile device never runs agents. */
  may_run: z.boolean(),
  /** "Use Orca on this device": new sessions run in Orca (add-orca-session-host). */
  use_orca: z.boolean().default(false),
  checkouts: z
    .array(
      z.looseObject({
        project: projectSlug,
        path: z.string().min(1),
        /** The session host of the sessions of this project on this device. */
        session_host: sessionHost.optional(),
        /**
         * The HLC of the last change of this checkout (openspec project-remove). A remove of the
         * project after it drops the checkout. Not set: an older checkout.
         */
        bound_at: hlcText.optional(),
      }),
    )
    .default([]),
  plugins: z.array(z.string().min(1)).default([]),
  skills: z.array(z.string().min(1)).default([]),
  /** Test slot resources and their capacity, for example `k3d: 1` (docs/architecture.md 4.7). */
  resources: z.record(entryName, z.int().min(1)).default({}),
  /**
   * The VAPID public key of a computer for Web Push (docs/phase-1.md 8.1): the uncompressed P-256
   * point, base64url with no padding. Null on a phone.
   */
  vapid_public_key: vapidKey.nullable().default(null),
});
export type BindingsDocument = z.infer<typeof bindingsV1>;

/** `secure/test-servers.yaml`: a shared file, on computers only. */
export const testServersV1 = z.looseObject({
  kind: z.literal("test-servers"),
  schema: z.literal(1),
  servers: z
    .array(
      z.looseObject({
        name: entryName,
        description: z.string().default(""),
        /** The device that runs the server or holds its slot resource. */
        device: deviceSlug.nullable().default(null),
        resource: entryName.nullable().default(null),
        url: z.string().min(1).nullable().default(null),
        /** Credential names only. */
        credentials: z.array(entryName).default([]),
      }),
    )
    .default([]),
});
export type TestServersDocument = z.infer<typeof testServersV1>;
