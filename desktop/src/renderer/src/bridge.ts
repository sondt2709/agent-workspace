// The renderer side of the preload bridge: `call()` unwraps the plain result of main and throws a
// `BridgeCallError` with the awd error code.
import type {
  AwBridge,
  CallArgs,
  CallError,
  CallMethod,
  CallValue,
} from "../../shared/channels.ts";

declare global {
  interface Window {
    aw: AwBridge;
  }
}

export class BridgeCallError extends Error {
  readonly code: string;
  readonly status: number | null;
  /** The `details` of the awd error, for example the answer of a resolved gate. */
  readonly details: unknown;

  constructor(error: CallError) {
    super(error.message);
    this.name = "BridgeCallError";
    this.code = error.code;
    this.status = error.status;
    this.details = error.details ?? null;
  }
}

export function bridge(): AwBridge {
  return window.aw;
}

export async function call<M extends CallMethod>(
  method: M,
  args: CallArgs<M>,
): Promise<CallValue<M>> {
  const result = await bridge().call(method, args);
  if (result.ok) return result.value;
  throw new BridgeCallError(result.error);
}

/** The text of an error for the screen. */
export function errorText(error: unknown): string {
  if (error instanceof BridgeCallError && error.code === "unreachable") {
    return "awd is not reachable. Start it with: aw service install";
  }
  return error instanceof Error ? error.message : String(error);
}
