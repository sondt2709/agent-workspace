// The unit context of this computer (openspec gap-install): the `aw service` commands and the
// setup check use it.
import { userInfo } from "node:os";
import { join } from "node:path";
import { entryPath } from "../entry.ts";
import type { Settings } from "../settings.ts";
import { servicePath, type UnitContext } from "../units/units.ts";

/** The awd entry point that a service unit starts. */
export const AWD_ENTRY = entryPath(import.meta.url, "../bin/awd");

/** The unit context of the user of this process. */
export function localUnitContext(settings: Settings, uid: number): UnitContext {
  return {
    nodePath: process.execPath,
    awdEntry: AWD_ENTRY,
    awHome: settings.home,
    customHome: settings.home !== join(settings.userHome, ".aw"),
    userHome: settings.userHome,
    userName: userInfo().username,
    uid,
    path: servicePath({
      installPath: settings.sessions.path,
      userHome: settings.userHome,
      nodePath: process.execPath,
    }),
  };
}
