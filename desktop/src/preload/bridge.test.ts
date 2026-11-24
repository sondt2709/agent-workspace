import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { CHANNELS } from "../shared/channels.ts";
import { createBridge, type BridgeIpc } from "./bridge.ts";

function fakeIpc() {
  const emitter = new EventEmitter();
  const invoke = vi.fn(() => Promise.resolve({ ok: true, value: [] }));
  const send = vi.fn();
  const ipc: BridgeIpc = {
    invoke,
    send,
    on: (channel, listener) => emitter.on(channel, listener),
    removeListener: (channel, listener) => emitter.removeListener(channel, listener),
  };
  return { ipc, emitter, invoke, send };
}

describe("createBridge", () => {
  it("sends each call on the one call channel", async () => {
    const { ipc, invoke } = fakeIpc();
    const bridge = createBridge(ipc);
    await bridge.call("tasks", { ws: "-" });
    expect(invoke).toHaveBeenCalledWith(CHANNELS.call, { method: "tasks", args: { ws: "-" } });
  });

  it("removes a listener with the function that on*() returns", () => {
    const { ipc, emitter } = fakeIpc();
    const bridge = createBridge(ipc);
    const got: unknown[] = [];
    const off = bridge.onEvent((message) => got.push(message));
    emitter.emit(CHANNELS.event, {}, { type: "hello", version: "0.0.0" });
    off();
    emitter.emit(CHANNELS.event, {}, { type: "hello", version: "0.0.1" });
    expect(got).toEqual([{ type: "hello", version: "0.0.0" }]);
    expect(emitter.listenerCount(CHANNELS.event)).toBe(0);
  });

  it("calls the resync listener with no argument", () => {
    const { ipc, emitter } = fakeIpc();
    const listener = vi.fn();
    const off = createBridge(ipc).onResync(listener);
    emitter.emit(CHANNELS.resync, {});
    expect(listener).toHaveBeenCalledWith();
    off();
    expect(emitter.listenerCount(CHANNELS.resync)).toBe(0);
  });

  it("tells main that the renderer listens for commands after it subscribes (fix list 0-12)", () => {
    const { ipc, emitter, send } = fakeIpc();
    const got: unknown[] = [];
    send.mockImplementation(() => {
      // Main sends the waiting command as the answer to the ready message.
      emitter.emit(CHANNELS.command, {}, { open: "task", ws: "w1", task: "t1" });
    });
    const off = createBridge(ipc).onCommand((command) => got.push(command));
    expect(send).toHaveBeenCalledWith(CHANNELS.commandReady);
    expect(got).toEqual([{ open: "task", ws: "w1", task: "t1" }]);
    off();
  });
});
