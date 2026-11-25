// Tests of the route access of the caller rule (add-mcp-server, decision 5): fail-closed, so a new
// write route that forgets `config.access` is a person route.
import { describe, expect, it } from "vitest";
import { createLogger } from "../log.ts";
import { Daemon } from "../service/daemon.ts";
import { loadSettings } from "../settings.ts";
import { createApp } from "./app.ts";
import { routeAccess, type Access } from "./caller.ts";

describe("route access", () => {
  it("is the config of the route, else read for GET and HEAD and person for a write", () => {
    expect(routeAccess("GET", undefined)).toBe("read");
    expect(routeAccess("HEAD", undefined)).toBe("read");
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(routeAccess(method, undefined), method).toBe("person");
    }
    expect(routeAccess("POST", "read")).toBe("read");
    expect(routeAccess("POST", "agent")).toBe("agent");
    expect(routeAccess("PUT", "caller")).toBe("caller");
    expect(routeAccess("GET", "person")).toBe("person");
  });

  it("makes each work loop route an agent route, so it needs the token of its session", async () => {
    // The app needs a daemon object. It never starts, so no file or socket is touched.
    const daemon = new Daemon({
      settings: loadSettings({ AW_HOME: "/nonexistent/aw", HOME: "/nonexistent" }),
      log: createLogger("silent"),
      watch: false,
      heartbeat: false,
    });
    const access = new Map<string, Access>();
    const app = await createApp(daemon, {
      onRoute: (route) => {
        for (const method of [route.method].flat()) {
          access.set(`${method} ${route.url}`, routeAccess(method, route.access));
        }
      },
    });
    await app.ready();
    await app.close();
    // The slot routes of add-continuity are agent routes too (integrate-continuity).
    for (const path of [
      "proposal",
      "approach",
      "ready",
      "tasks",
      "gate",
      "result",
      "done",
      "slots/acquire",
      "slots/release",
    ]) {
      expect(access.get(`POST /v1/sessions/:session/${path}`), path).toBe("agent");
    }
    // The person creates a task on the workspace route, which a session caller cannot use.
    expect(access.get("POST /v1/workspaces/:ws/tasks")).toBe("person");
    // The desktop routes (integrate-ui) are person routes, also the reads.
    for (const route of [
      "GET /v1/workspaces/:ws/presence",
      "GET /v1/workspaces/:ws/session-hosts",
      "GET /v1/workspaces/:ws/tasks/:task/files",
      "GET /v1/workspaces/:ws/tasks/:task/files/content",
      "POST /v1/workspaces/:ws/documents/restore",
      // The setup routes (gap-setup).
      "PATCH /v1/workspaces/:ws",
      "DELETE /v1/workspaces/:ws",
      "PATCH /v1/workspaces/:ws/projects/:project",
      "GET /v1/workspaces/:ws/bindings",
      "PATCH /v1/workspaces/:ws/bindings",
      "PUT /v1/sync/settings",
    ]) {
      expect(access.get(route), route).toBe("person");
    }
  });
});
