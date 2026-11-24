// The MCP variables of a session (design of add-mcp-server, decision 10): aw-launch exports them
// for the plugin `.mcp.json` and for the aw CLI and the hooks of the session.
// - AW_MCP_TOKEN whenever the token file exists: it is the only agent identity on the local API,
//   so the CLI fallback and the permission hooks need it also when the MCP server is off.
// - AW_MCP_URL only with a port file: with MCP off, the default of `.mcp.json` makes each MCP call
//   fail with a host name that says why, and the agent uses the aw CLI.
import { readFile } from "node:fs/promises";
import { tokenFile } from "./tokens.ts";

export async function mcpEnvironment(
  portFile: string,
  home: string,
  session: string,
): Promise<{ AW_MCP_URL?: string; AW_MCP_TOKEN?: string }> {
  const port = (await readFile(portFile, "utf8").catch(() => "")).trim();
  const token = (await readFile(tokenFile(home, session), "utf8").catch(() => "")).trim();
  return {
    ...(/^[0-9]{1,5}$/.test(port) ? { AW_MCP_URL: `http://127.0.0.1:${port}/mcp` } : {}),
    ...(token.length > 0 ? { AW_MCP_TOKEN: token } : {}),
  };
}
