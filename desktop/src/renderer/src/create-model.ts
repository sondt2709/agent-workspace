// The pure rules of the create flows (openspec create-flows): the project name and slug from a
// checkout folder, the checks of a picked folder, and the agent of "Start the agent now".
import type { Project } from "../../shared/channels.ts";

/** The help text of the Location field of a workspace (openspec workspace-folder). */
export const LOCATION_HELP =
  "The folder that holds the workspace folder. It can hold other files. AW makes the folder <name> in it, or <name>-aw1 when that name is in use. Leave it empty for ~/AW. Never a folder inside a code checkout.";
/** The help text of the Location field of "Add a workspace": it also registers a synced folder. */
export const ADD_LOCATION_HELP = `${LOCATION_HELP} Choose a workspace folder that another device synced to add that workspace.`;
/** The error text of a Location that is not absolute. */
export const BAD_LOCATION = "Give an absolute path, for example /Users/example/Work.";

/** The slug rule of awd (`projectSlug`): lowercase letters, digits and `-` between them; 1 to 63 characters. */
export const SLUG = /^(?=.{1,63}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A slug from a name: `Billing API` gives `billing-api`; at most 63 characters. */
export function slugFrom(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/, "");
}

/** The last part of an absolute folder: `/Users/example/dev/example-org/billing-api` gives `billing-api`. */
export function folderName(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? "";
}

/** True when `folder` is `root` or a folder inside it. */
export function isInside(folder: string, root: string): boolean {
  const clean = (p: string) => p.replace(/\/+$/, "");
  const f = clean(folder);
  const r = clean(root);
  return r.length > 0 && (f === r || f.startsWith(`${r}/`));
}

/** The problem of a checkout folder that blocks "Add project", or null. */
export function checkoutProblem(path: string, workspacePath: string | null): string | null {
  if (workspacePath && isInside(path, workspacePath)) {
    return `This folder is inside the workspace folder ${workspacePath}. Your devices sync that folder, so choose a checkout outside it.`;
  }
  return null;
}

/** The warning of a checkout folder with no `.git`. */
export const NOT_GIT =
  "This folder is not a git repository. Each session works in a git worktree of the checkout, so a session cannot start until the folder is a git repository.";

/** "Start the agent now": the default agent of the project on its first device, or null. */
export function startAgent(project: Pick<Project, "default_agent" | "devices"> | undefined) {
  const device = project?.devices[0];
  return project && device ? `${project.default_agent}@${device}` : null;
}

/** What a dialog knows about the checkouts: the bindings of this device and the host list. */
export interface CheckoutsInfo {
  /** This device and its checkouts with their paths (the bindings route). */
  self: { device: string; checkouts: { project: string; path: string }[] } | undefined;
  /** Each computer and the projects it has a checkout of (the session-hosts route). */
  devices: { device: string; checkouts: { project: string }[] }[] | undefined;
}

/**
 * Where a session of `project` on `device` works, as one line (review F-22, ux-1), and whether
 * the device has no checkout of the project. Null while the data loads or with no device.
 */
export function sessionFolder(
  info: CheckoutsInfo,
  device: string,
  project: string | null,
  key: string | null,
  where: { workIn: "worktree" | "checkout" | "folder"; folder: string } = {
    workIn: "worktree",
    folder: "",
  },
): { text: string; missing: boolean } | null {
  if (!device || !project) return null;
  const branch = `aw/${key ?? "<key>"}`;
  // Another folder needs no checkout (openspec session-options).
  if (where.workIn === "folder") {
    return {
      text: where.folder
        ? `Works in ${where.folder} on ${device}, as it is: no worktree and no branch change.`
        : `Choose the folder on ${device}.`,
      missing: false,
    };
  }
  if (info.self && info.self.device === device) {
    const path = info.self.checkouts.find((c) => c.project === project)?.path;
    if (path && where.workIn === "checkout") {
      return { text: `Works in the checkout ${path} on the branch ${branch}.`, missing: false };
    }
    return path
      ? {
          text: `Works in a git worktree aw-${key ?? "<key>"} of ${path} on the branch ${branch}.`,
          missing: false,
        }
      : {
          text: `${device} has no checkout of ${project}. Choose the folder in the project settings.`,
          missing: true,
        };
  }
  const entry = info.devices?.find((d) => d.device === device);
  if (!entry) return null;
  return entry.checkouts.some((c) => c.project === project)
    ? {
        text:
          where.workIn === "checkout"
            ? `Works in the ${project} checkout on ${device}, on the branch ${branch}.`
            : `Works in a git worktree of the ${project} checkout on ${device}, on the branch ${branch}.`,
        missing: false,
      }
    : {
        text: `${device} has no checkout of ${project}. Set the folder in the project settings on ${device}.`,
        missing: true,
      };
}
