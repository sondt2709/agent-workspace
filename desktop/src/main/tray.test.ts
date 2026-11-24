import { AwApiError, AwUnreachableError } from "@aw/client";
import { describe, expect, it } from "vitest";
import type { SyncStatusReply, Task } from "../shared/channels.ts";
import {
  countNeedsYou,
  countsAfterError,
  countUnsynced,
  TRAY_ICON_PNG_BASE64,
  trayModel,
} from "./tray.ts";

describe("trayModel", () => {
  it("shows the needs-you count as the title and both counts in the menu", () => {
    const model = trayModel({ needsYou: 2, unsynced: 3, online: true });
    expect(model.title).toBe("2");
    const labels = model.items.flatMap((i) => ("label" in i ? [i.label] : []));
    expect(labels).toEqual([
      "2 need you",
      "3 changes not synced",
      "Sync now",
      "Open Agent Workspace",
      "Quit Agent Workspace",
    ]);
  });

  it("has an empty title when nothing needs the person or awd is not reachable", () => {
    expect(trayModel({ needsYou: 0, unsynced: 0, online: true }).title).toBe("");
    const offline = trayModel({ needsYou: 4, unsynced: null, online: false });
    expect(offline.title).toBe("");
    expect(offline.items[0]).toEqual({ type: "text", label: "awd is not reachable" });
  });
});

describe("counts", () => {
  it("counts the tasks in the Needs you lane and the items the peers need", () => {
    const tasks = [
      { needs_you_lane: true, archived: false },
      { needs_you_lane: true, archived: true },
      { needs_you_lane: false, archived: false },
    ] as Task[];
    expect(countNeedsYou([{ tasks }, { tasks }])).toBe(2);
    const status = { peers: [{ needItems: 3 }, { needItems: 0 }, { needItems: -1 }] };
    expect(countUnsynced(status as SyncStatusReply)).toBe(3);
  });

  it("has a PNG icon", () => {
    expect(Buffer.from(TRAY_ICON_PNG_BASE64, "base64").subarray(1, 4).toString()).toBe("PNG");
  });
});

describe("countsAfterError (devices-kb review 8)", () => {
  const counts = { needsYou: 2, unsynced: 0, online: true };
  it("marks awd as not reachable only for an unreachable error", () => {
    expect(
      countsAfterError(counts, new AwUnreachableError("/tmp/awd.sock", "ECONNREFUSED")),
    ).toEqual({ ...counts, online: false });
    expect(countsAfterError(counts, new AwApiError(503, null, "not ready"))).toEqual(counts);
  });
});
