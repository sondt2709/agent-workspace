// The community switch of the transport (openspec gap-setup, sync-engine: community switch at run
// time). A test with a running engine would send traffic to the community servers, so the running
// path is in the "Test later" list of gap-setup.
import { systemClock } from "@aw/core";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { communityOptions, SyncthingTransport } from "./transport.ts";

const silent = { debug() {}, info() {}, warn() {}, error() {} };

describe("communityOptions", () => {
  it("turns global discovery, relays and the LAN address announce on or off, never local discovery", () => {
    expect(communityOptions(false)).toEqual({
      localAnnounceEnabled: true,
      globalAnnounceEnabled: false,
      relaysEnabled: false,
      announceLANAddresses: false,
    });
    expect(communityOptions(true)).toEqual({
      localAnnounceEnabled: true,
      globalAnnounceEnabled: true,
      relaysEnabled: true,
      announceLANAddresses: true,
    });
  });
});

describe("SyncthingTransport.setCommunity", () => {
  it("keeps the value for the next engine start when no engine runs", async () => {
    const transport = new SyncthingTransport({
      binary: "/nonexistent/syncthing",
      home: join(tmpdir(), "aw-community-test"),
      device: { slug: "macbook-pro", role: "local" },
      listen: "tcp://127.0.0.1:22399",
      community: true,
      clock: systemClock,
      log: silent,
    });
    expect(transport.community).toBe(true);
    expect(await transport.setCommunity(false)).toBe(false);
    expect(transport.community).toBe(false);
  });
});
