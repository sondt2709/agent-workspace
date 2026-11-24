// The zod schemas of the setup calls (openspec gap-setup), part of the bridge contract. Main parses
// each payload before it calls awd; awd checks the bodies again with its own schemas.
import { z } from "zod";

const id = z.string().min(1).max(200);
const slug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(64);
const name = z
  .string()
  .regex(/^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/)
  .max(128);
const link = z.string().min(1).max(2000);
const host = z.enum(["tmux", "orca"]);
const none = z.object({}).strict();

const editProjectBody = z
  .object({
    name: z.string().min(1).max(200).optional(),
    devices: z.array(slug).max(100).optional(),
    default_agent: z
      .string()
      .regex(/^[a-z][a-z0-9-]*$/)
      .optional(),
    links: z.array(link).max(100).optional(),
    main_repo: link.nullable().optional(),
    test_servers: z.array(name).max(100).optional(),
    switches: z
      .object({ assign_new_subtasks_to_default_device: z.boolean().optional() })
      .strict()
      .optional(),
    permission_mode: z.enum(["default", "accept_edits", "skip"]).optional(),
    archived: z.boolean().optional(),
  })
  .strict();

const editBindingsBody = z
  .object({
    use_orca: z.boolean().optional(),
    resources: z.record(name, z.int().min(1).max(1000)).optional(),
    checkouts: z
      .array(
        z
          .object({
            project: slug,
            path: z.string().min(1).max(4096).nullable(),
            session_host: host.optional(),
          })
          .strict(),
      )
      .max(200)
      .optional(),
  })
  .strict();

function call<M extends string, A extends z.ZodType>(method: M, args: A) {
  return z.object({ method: z.literal(method), args }).strict();
}

/** The setup calls; contract.ts adds them to `callRequest`. */
export const setupCalls = [
  call(
    "initWorkspace",
    z
      .object({
        name: z.string().trim().min(1).max(200).optional(),
        path: z.string().min(1).max(4096).optional(),
        // The location that holds the workspace folder (openspec workspace-folder).
        parent: z.string().min(1).max(4096).startsWith("/").optional(),
      })
      .strict(),
  ),
  call("renameWorkspace", z.object({ ws: id, name: z.string().trim().min(1).max(200) }).strict()),
  call(
    "editWorkspace",
    z
      .object({
        ws: id,
        body: z
          .object({
            name: z.string().trim().min(1).max(200).optional(),
            new_project_permission_mode: z.enum(["default", "accept_edits", "skip"]).optional(),
          })
          .strict(),
      })
      .strict(),
  ),
  call("removeWorkspace", z.object({ ws: id }).strict()),
  call(
    "addProject",
    z
      .object({
        ws: id,
        body: z.object({ slug, name: z.string().trim().min(1).max(200).optional() }).strict(),
      })
      .strict(),
  ),
  call("editProject", z.object({ ws: id, project: slug, body: editProjectBody }).strict()),
  call("projectRemoval", z.object({ ws: id, project: slug }).strict()),
  call("removeProject", z.object({ ws: id, project: slug }).strict()),
  call("bindings", z.object({ ws: id }).strict()),
  call("editBindings", z.object({ ws: id, body: editBindingsBody }).strict()),
  call("syncSettings", none),
  call("setSyncSettings", z.object({ community: z.boolean() }).strict()),
] as const;
