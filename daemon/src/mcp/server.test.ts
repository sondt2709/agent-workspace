// Tests of the MCP listener (add-mcp-server, decision 2): the port range, the port file, MCP off,
// and no free port.
import { existsSync, statSync } from "node:fs";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { dirname } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startTestDaemon, type TestDaemon } from "../testing.ts";
import { lastPortFile, startMcpServer, type McpListener } from "./server.ts";

let d: TestDaemon | null = null;
const held: Server[] = [];
let listener: McpListener | null = null;

afterEach(async () => {
  await listener?.close();
  listener = null;
  for (const server of held.splice(0)) await new Promise((resolve) => server.close(resolve));
  await d?.close();
  d = null;
});

/** Holds a free port on 127.0.0.1 and returns it. */
async function holdPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  held.push(server);
  return (server.address() as { port: number }).port;
}

describe("MCP listener", () => {
  it("takes the next port when the first one is in use, and writes the port file", async () => {
    d = await startTestDaemon({ env: { AW_MCP_PORT: "off" } });
    const taken = await holdPort();
    const free = await holdPort();
    await new Promise((resolve) => held.pop()!.close(resolve));
    listener = await startMcpServer(d.server.daemon, { ports: [taken, free] });
    expect(listener?.port).toBe(free);
    const file = d.settings.mcp.portFile;
    expect((await readFile(file, "utf8")).trim()).toBe(String(free));
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(listener!.app.server.address()).toMatchObject({ address: "127.0.0.1" });
    await listener!.close();
    listener = null;
    expect(existsSync(file)).toBe(false);
  });

  it("runs with no MCP server when no port is free, or when it is off", async () => {
    d = await startTestDaemon({ env: { AW_MCP_PORT: "off" } });
    expect(d.server.mcp).toBeNull();
    expect(existsSync(d.settings.mcp.portFile)).toBe(false);
    const taken = await holdPort();
    expect(await startMcpServer(d.server.daemon, { ports: [taken] })).toBeNull();
    expect(existsSync(d.settings.mcp.portFile)).toBe(false);
    expect(
      d
        .logLines()
        .some((l) => l.msg === "No free port for the MCP server: awd runs with no MCP server"),
    ).toBe(true);
    // The local API still answers.
    expect(await d.client.health()).toEqual({ status: "ok" });
  });

  it("listens and writes the port file before the workspaces and the sessions start", async () => {
    d = await startTestDaemon();
    const lines = d.logLines().map((l) => l.msg);
    const listens = lines.indexOf("The MCP server listens");
    expect(listens).toBeGreaterThan(-1);
    // aw-launch of a session that opens during the start reads the port file at /readyz.
    expect(listens).toBeLessThan(lines.indexOf("awd starts"));
  });

  it("tries the port of the last run first", async () => {
    d = await startTestDaemon({ env: { AW_MCP_PORT: "off" } });
    const first = await holdPort();
    const last = await holdPort();
    for (const server of held.splice(0)) await new Promise((resolve) => server.close(resolve));
    await writeFile(lastPortFile(d.settings.mcp.portFile), `${last}\n`);
    listener = await startMcpServer(d.server.daemon, { ports: [first, last] });
    expect(listener?.port).toBe(last);
    await listener!.close();
    listener = null;
    // The last port stays after the stop; a last port out of the range is not tried.
    expect((await readFile(lastPortFile(d.settings.mcp.portFile), "utf8")).trim()).toBe(
      String(last),
    );
    await writeFile(lastPortFile(d.settings.mcp.portFile), "1\n");
    listener = await startMcpServer(d.server.daemon, { ports: [first, last] });
    expect(listener?.port).toBe(first);
  });

  it("frees the port when the port file cannot be written", async () => {
    d = await startTestDaemon({ env: { AW_MCP_PORT: "off" } });
    const port = await holdPort();
    await new Promise((resolve) => held.pop()!.close(resolve));
    const run = dirname(d.settings.mcp.portFile);
    await chmod(run, 0o500);
    try {
      await expect(startMcpServer(d.server.daemon, { ports: [port] })).rejects.toThrow();
    } finally {
      await chmod(run, 0o700);
    }
    // The port is free again: the bound listener was closed.
    listener = await startMcpServer(d.server.daemon, { ports: [port] });
    expect(listener?.port).toBe(port);
  });

  it("stops the awd start on a bad AW_MCP_PORT; the aw CLI does not fail on it", async () => {
    await expect(startTestDaemon({ env: { AW_MCP_PORT: "abc" } })).rejects.toThrow(
      "AW_MCP_PORT must be a port number, 0 or off, not abc",
    );
    d = await startTestDaemon();
    const status = await d.aw(["status"], {
      env: { AW_HOME: d.home, HOME: d.home, AW_MCP_PORT: "abc" },
    });
    expect(status.code, status.stderr).toBe(0);
  });
});
