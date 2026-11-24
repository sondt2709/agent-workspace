// The preload bridge `window.aw` (docs/tech-stack.md 2.3). It forwards each call on the one `call`
// channel, and each `on*()` returns a function that removes its listener. Main checks the payload.
import {
  CHANNELS,
  type AppCommand,
  type AwBridge,
  type ConnectionState,
  type StreamMessage,
} from "../shared/channels.ts";

/** The parts of `ipcRenderer` that the bridge uses. */
export interface BridgeIpc {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  send(channel: string, ...args: unknown[]): void;
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown;
  removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown;
}

export function createBridge(ipc: BridgeIpc): AwBridge {
  function listen<T>(channel: string) {
    return (listener: (payload: T) => void) => {
      const handler = (_event: unknown, payload: unknown) => listener(payload as T);
      ipc.on(channel, handler);
      return () => {
        ipc.removeListener(channel, handler);
      };
    };
  }
  return {
    call: (method, args) => ipc.invoke(CHANNELS.call, { method, args }) as never,
    onEvent: listen<StreamMessage>(CHANNELS.event),
    onConnection: listen<ConnectionState>(CHANNELS.connection),
    onResync: (listener) => listen<undefined>(CHANNELS.resync)(() => listener()),
    onCommand: (listener) => {
      const off = listen<AppCommand>(CHANNELS.command)(listener);
      // Main keeps a command for a new window until the renderer listens (fix list 0-12).
      ipc.send(CHANNELS.commandReady);
      return off;
    },
  };
}
