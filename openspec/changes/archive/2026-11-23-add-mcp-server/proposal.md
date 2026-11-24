## Why
Agents in AW sessions use only the `aw` CLI now, and each local API call without a session header acts as `human@<device>`. So an agent can answer its own gate or accept its own knowledge suggestion through the local API (plan follow-up 5, sessions-tmux L3). Agents also need typed tools with small, paged results (`docs/architecture.md` 6.4, `docs/phase-1.md` 9.8, ADR-19).

## What Changes
- New MCP server in awd: MCP Streamable HTTP (SDK v2, stateless) on `http://127.0.0.1:<port>/mcp`, port 7433 or the next free port up to 7442, written to `~/.aw/run/mcp.port`. A second fastify instance with the Host and Origin guards of the SDK adapter, a 4 MB body limit, the awd logger, and a bearer token per session.
- New session token: awd mints one token for each session at the start, keeps it in `~/.aw/sessions/<session>/mcp-token` (0600), binds it to the session, the task and this device, and revokes it when the session stops, moves, is replaced or fails. A missing, bad or revoked token gets HTTP 401 with no `WWW-Authenticate` challenge. Claude Code reports a server with a configured `Authorization` header as failed and starts no OAuth flow (Claude Code MCP docs, "Authenticate with remote MCP servers").
- New MCP tools: `thread`, `ask`, `message`, `stage`, `artifact_add`, `handoff`, `learn` call the same service methods as the CLI. `approach`, `ready`, `task_create`, `gate`, `slot_acquire`, `slot_release`, `result` and `done` are registered and return the error `not_available` until task-loop and continuity build them. Resources: the task fields of the session, the knowledge list and a knowledge file.
- **BREAKING** (local API, no release yet): the session token replaces the header `X-AW-Session` as the source of the agent identity. The CLI and the hooks send `Authorization: Bearer <token>` from `AW_MCP_TOKEN`. The agent routes `/v1/sessions/{session}/ask|message|stage|artifacts|handoff|permission` need the token of that session.
- The agent-vs-human rule on all person routes of the local API: workspace init, project add, task create, edit, assign, archive, gate answer, session stop, the sync write routes, knowledge accept and reject, and knowledge writes to `shared/` or to a rule. A session caller gets 403 `refused`. A caller with no token is the person only when its process is not a process of a running session (peer process check on the socket); the remaining same-OS-user risk goes into `SECURITY.md`.
- A transient session state (the session runs, but awd has not attached its workspace yet) gives 503 `not_ready` on the MCP tools, the agent routes and the knowledge routes, not 403.
- Plugin `.mcp.json` with the server `aw` (`"type": "http"`, `${AW_MCP_URL:-…}`, `Authorization: Bearer ${AW_MCP_TOKEN:-none}`). `aw-launch` exports `AW_MCP_URL` and `AW_MCP_TOKEN`. A contract test checks the plugin name, the server key and the allow rule `mcp__plugin_aw_aw__*`.
- The skill `SKILL.md` names the MCP tools first and the `aw` commands as the fallback.

## Capabilities

### New Capabilities
- `mcp-server`: the MCP endpoint of awd, the port file, the guards, the session token, the tools, the resources and the error mapping.

### Modified Capabilities
- `local-api`: the caller rule (token, peer process, person), the person routes, the agent routes with the token, and 503 for a transient session.
- `aw-cli`: the CLI sends the session token; the client option `token` replaces `session` for the identity.
- `agent-claude-plugin`: `.mcp.json`, `aw-launch` exports `AW_MCP_URL` and `AW_MCP_TOKEN`, and the contract test of the server key.
- `agent-sessions`: the token at the session start, kept over resumes, and revoked at each stop.
- `awd-service`: the MCP listener after the start, the port file, and the setting `AW_MCP_PORT` (a port, `0` for any free port, or `off`).

## Impact
- Code: new `daemon/src/mcp/` (server, tools, tokens, peer check), small edits in `daemon/src/server.ts`, `daemon/src/settings.ts`, `daemon/src/api/app.ts`, `daemon/src/api/sessions.ts`, `daemon/src/api/knowledge.ts`, `daemon/src/sessions/manager.ts`, `daemon/src/sessions/service.ts`, `daemon/src/sessions/records.ts`, `daemon/src/bin/aw-launch.ts`, `daemon/src/bin/aw-hook.ts`, `daemon/src/cli/run.ts`, `shared/client/src/index.ts`, `plugins/agent-claude/plugin/.mcp.json` and `SKILL.md`.
- Dependencies (approval A 1): `@modelcontextprotocol/server` 2.4.0, `@modelcontextprotocol/fastify` 2.0.1, `@modelcontextprotocol/node` 2.1.2 (the `toNodeHandler` bridge of the fastify recipe), and `@modelcontextprotocol/client` 2.4.0 for the tests.
- Contract: `contracts/openapi.yaml` (the `Authorization` header, the 403 of person routes; regenerated).
- Docs: `docs/tech-stack.md` 1.1 and 2.2, `docs/phase-1.md` 9.8 and 5.10, `docs/architecture.md` 6.4, `docs/workflow.md` 8, `SECURITY.md`, `AGENTS.md`.
- Undo: remove `daemon/src/mcp/` and `.mcp.json`, revert the small edits, remove the 4 dependencies, and run `pnpm api:generate`.
