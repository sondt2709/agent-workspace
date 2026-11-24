// Test helpers of @aw/agent-claude: the fake claude and the captured payloads.
import { fileURLToPath } from "node:url";

export { capturedPayloads, payload, type SessionFields } from "./payloads.ts";

/** The fake `claude` binary for `AW_CLAUDE`. */
export const FAKE_CLAUDE = fileURLToPath(new URL("../../testing/bin/claude", import.meta.url));
