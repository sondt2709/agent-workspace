## 1. Dependencies and settings

- [x] 1.1 Add `@modelcontextprotocol/server` 2.4.0, `@modelcontextprotocol/fastify` 2.0.1, `@modelcontextprotocol/node` 2.1.2 to `daemon/`, and `@modelcontextprotocol/client` 2.4.0 as a dev dependency; rows in `docs/tech-stack.md` 2.2 and 2.6
- [x] 1.2 Settings: `AW_MCP_PORT` (unset, number, `0`, `off`), `AW_MCP_TOKEN` in `settings.sessions.token` (also with no `AW_SESSION`); tests

## 2. Session token

- [x] 2.1 `daemon/src/mcp/tokens.ts`: mint (`awt_` + 32 bytes base64url), file `mcp-token` (0600), hash map, constant-time compare, load at start, revoke
- [x] 2.2 Session manager: mint before the first window open, keep over resumes, mint for a running record with no token; revoke when a record leaves `running` (in the record save)
- [x] 2.3 `SessionService.callerOfToken()` with `not_ready` for a running session of a workspace that is not attached; `runningPanes()` for the peer check

## 3. Caller rule on the local API

- [x] 3.1 `ServiceError` code `unauthorized` (401) and the CLI exit code 1 for it
- [x] 3.2 `daemon/src/api/caller.ts`: `onRequest` hook (token, then peer check, then person), `config.access` per route, 403 for a session caller on a person route
- [x] 3.3 `daemon/src/api/peer.ts`: peer pid of a socket connection (macOS `lsof`, Linux `ss`), parent chain with `ps`, warning and person on a failed check
- [x] 3.4 Mark the person routes (`app.ts`, `sessions.ts`, `sync-routes.ts`, knowledge accept and reject); agent routes need the token of the session in the path
- [x] 3.5 Knowledge routes: caller from the request, not from `X-AW-Session`; `kbCallerHeaders` documents the `authorization` header
- [x] 3.6 `AwClient` option `token` (`Authorization: Bearer`), remove `session` and `SESSION_HEADER`; the CLI and `aw-hook` send `AW_MCP_TOKEN`; `pnpm api:generate`

## 4. MCP server

- [x] 4.1 `daemon/src/mcp/server.ts`: second fastify (logger, 4 MiB, Host and Origin hooks), `/mcp` with `toNodeHandler(createMcpHandler(factory))`, 401 with no challenge, port range and `mcp.port`, close
- [x] 4.2 `daemon/src/mcp/tools.ts`: `thread`, `ask`, `message`, `stage`, `artifact_add`, `handoff`, `learn`, the `not_available` tools, the annotations, the instructions (< 4,096 characters), the error envelope, the 60 s retry cache
- [x] 4.3 Resources `aw://task`, `aw://knowledge`, `aw://knowledge/{+path}`
- [x] 4.4 `startServer`: listen before `daemon.start()` (after the local API), close first at the stop; a failed listen is logged and awd runs on

## 5. Plugin and launcher

- [x] 5.1 `plugins/agent-claude/plugin/.mcp.json`; contract test of the name, the server key, the variables and the allow rule
- [x] 5.2 `aw-launch`: export `AW_MCP_URL` and `AW_MCP_TOKEN` from `run/mcp.port` and `mcp-token`
- [x] 5.3 `SKILL.md`: the MCP tools first, the `aw` commands as the fallback (< 6,000 characters)

## 6. Tests

- [x] 6.1 MCP e2e with the SDK client against awd with sessions: each implemented tool gives the same result as the API; bad, missing and revoked token get 401; token of task A on task B is refused; Host and Origin guards; retry cache; `not_available`; resources; restart keeps the token; not attached gives `not_ready`
- [x] 6.2 Caller rule: a session token and a session process with no token are refused on each person route (API and CLI); the person is accepted; agent routes need the token
- [x] 6.3 Unit tests: tokens, peer check (captured `lsof` and `ss` outputs), port range and port file, settings
- [x] 6.4 Update the existing tests that used `X-AW-Session` or called the agent routes with no token
- [x] 6.5 Code review fixes: a session with `AW_MCP_PORT=off` (token, `aw ask`, permission hook), a resume during the awd start, the listener before the start (log order), the last port first, a failed port file write, a bad `AW_MCP_PORT` only for awd, `ask` again after an answer, a new version of an artifact, the thread budget and the ancestor limit, the fail-closed route access, the thread route rule for a session caller, the filtered `lsof`, the bearer header form of the knowledge writes

## 7. Docs and evidence

- [x] 7.1 Docs: `docs/tech-stack.md` 1.1 and 2.2, `docs/phase-1.md` 9.8 and 5.10, `docs/architecture.md` 6.4, `docs/workflow.md` 8, `SECURITY.md` (threat rows and the remaining risk), `AGENTS.md`
- [x] 7.2 Real Claude Code run on the Linux remote device with haiku (spike S12): plugin MCP server loads, `thread` or `ask` works, awd restart reconnects, bad token gives no OAuth prompt
- [x] 7.3 `task check`; break each new test once
