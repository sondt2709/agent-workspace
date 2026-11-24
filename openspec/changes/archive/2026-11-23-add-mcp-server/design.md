## Context
awd serves the local API on `~/.aw/run/awd.sock` (mode 0600). The sessions-tmux task added the agent routes `/v1/sessions/{session}/...` and the CLI agent commands. The knowledge integration added the header `X-AW-Session`: the knowledge routes treat a caller with that header as the agent. Each other write route acts as `human@<device>` for any caller, and a process that leaves out the header also acts as the person (plan follow-up 5, sessions-tmux L3).

Claude Code cannot use a Unix socket as an MCP URL. So the MCP server must listen on TCP loopback, and a token per session must name the caller (`docs/architecture.md` 6.4, `docs/phase-1.md` 9.8, ADR-19).

Two tasks run in parallel from the same commit (identity-pairing, host-orca). This change keeps its code in a new folder `daemon/src/mcp/` and a new file `daemon/src/api/caller.ts`, with small edits in the existing daemon files.

```
 Claude Code (session S, task T)             awd
  .mcp.json  aw: http ${AW_MCP_URL}     ──▶  127.0.0.1:7433/mcp  (fastify #2: Host+Origin guard, 4 MB)
             Authorization: Bearer ${AW_MCP_TOKEN}     │ token → {session S, task T, device}   401 if unknown
                                                       └▶ McpServer per request ─▶ SessionManager / KnowledgeService
  Bash: aw ask T "..."  (AW_MCP_TOKEN in env)  ──▶  awd.sock (fastify #1)
  aw-hook PermissionRequest                          onRequest: caller = token │ peer process │ person
                                                     person route + session caller ─▶ 403 refused
  aw-launch: reads mcp-token + run/mcp.port, exports AW_MCP_URL, AW_MCP_TOKEN, execve claude
```

## Goals / Non-Goals

**Goals:**
- Typed MCP tools for the agent primitives that have service code now, with the same service methods as the CLI.
- One identity source for agents: the session token, on the MCP endpoint and on the local API.
- Person routes refuse session callers, also a session process that leaves out the token, as far as the OS lets awd see it.
- No OAuth prompt in Claude Code for a bad token, and a reconnect after an awd restart.

**Non-Goals:**
- The tools `approach`, `ready`, `task_create`, `gate`, `slot_acquire`, `slot_release`, `result`, `done` (task-loop, continuity): they are registered and answer `not_available`.
- A credential of the person that an agent cannot read (OS keystore with a prompt). Same OS user: see Risks.
- MCP push to the agent (`architecture.md` 6.4.4: answers arrive as the next input).
- `aw mcp` (stdio fallback): only when spike S12 fails (decision 11).

## Decisions

1. **SDK and wiring.** `@modelcontextprotocol/server` 2.4.0 `createMcpHandler(factory)` (stateless; the default `legacy: 'stateless'` also serves 2025-era clients) and `toNodeHandler` of `@modelcontextprotocol/node` 2.1.2, in a route `app.all("/mcp")` of a second fastify instance. The fastify adapter 2.0.1 gives `localhostHostValidation()` and `localhostOriginValidation()` as `onRequest` hooks. awd builds its own `Fastify({ loggerInstance, bodyLimit: 4 MiB })` and does not use `createMcpFastifyApp()`: that function makes a fastify with no logger. This is the documented fastify recipe of the SDK ("Serve over Fastify"). Alternative: own web `Request` conversion: own code for a solved job (rule 4.8).

2. **Port and port file.** awd listens on `127.0.0.1` only. It tries 7433, then each port up to 7442 (`EADDRINUSE` moves to the next), and writes the port to `~/.aw/run/mcp.port` (0600) after the listen. It removes the file at the stop. `AW_MCP_PORT` in the settings: a number (only that port), `0` (any free port: the tests), or `off` (no MCP server). The listener starts after the local API listens and before `daemon.start()` (code review, high finding): the start opens windows (new sessions, resumes), and `aw-launch` reads the port file as soon as `/readyz` is ready. A tool call before the session manager is attached gets `not_ready` (decision 4), because the tokens load first. A failed port file write closes the listener. `mcp.port.last` keeps the last port, and the next start tries it first (a running agent keeps a valid URL when that port is free again). It stops before the daemon stops.

3. **Token per session.** 32 random bytes, base64url, prefix `awt_`. awd mints it before the first window of a session opens and writes `~/.aw/sessions/<session>/mcp-token` (0600). A resume keeps the token (the MCP config of the agent does not change). A record from before this change gets a token at its next window open. awd keeps a map from the sha256 of each token to its session in memory and loads the map from the session folders of the running records at start. A lookup hashes the presented token and compares the hash with `timingSafeEqual`. A save of a record with a state other than `running` revokes the token: it removes the map entry and the file. So `stopped`, `moved`, `replaced`, `ended` and `failed` all revoke, also a move found by the claim loop. Alternative: a token per window open: the agent's MCP config would hold a dead token after each resume.

4. **What a token names.** The token resolves to `{session, task, workspace, agent, device}` through `SessionService.caller()`. A record that runs, but whose workspace has no session manager yet, gives `not_ready` (503 on the local API, a tool error `not_ready` on MCP). That is the transient state of the integration review. An unknown token, a revoked token, a missing header and the text `none` give HTTP 401 on `/mcp` with a JSON-RPC error and no `WWW-Authenticate` header. Claude Code then marks the server failed, and starts no OAuth flow, because the server has a configured `Authorization` header (Claude Code MCP docs, "Authenticate with remote MCP servers"). Spike S12 checks this with the real agent.

5. **One caller rule on the local API** (`daemon/src/api/caller.ts`, an `onRequest` hook):
   - `Authorization: Bearer <token>` of a running session: the caller is that session. An unknown or revoked token: 401 `unauthorized` (a new error code of the envelope).
   - No token: the caller is the person, except when awd finds that the peer process of the socket connection is a process of a running session (decision 6). Then the caller is that session.
   - Each route has `config.access`: `person`, `agent`, `caller` or `read`. Fail-closed (code review): a route with no `access` is `read` for GET and HEAD and `person` for each other method, so a new write route of a parallel task that forgets `access` refuses a session caller. A session caller on a `person` route gets 403 `refused` with "… is an action of a person … Ask the human with aw ask". The `agent` routes (`/v1/sessions/{session}/ask|message|stage|artifacts|handoff|permission`) need the token of the session in the path, else 403 `refused`.
   - Person routes: `POST /v1/workspaces`, `POST .../projects`, `POST .../tasks`, `PATCH .../tasks/{task}`, `POST .../assign`, `POST .../archive`, `POST .../gates/{gate}/answer`, `POST /v1/sessions/{session}/stop`, `POST /v1/sync/now|pause|resume`, `POST|DELETE /v1/sync/peers`, `POST .../knowledge/suggestions/{id}/accept|reject`. The knowledge write, Undo and learn keep their own rule with the caller (a session writes as the agent; `shared/` and rules are refused).
   - The header `X-AW-Session` is gone. Reads (`GET`, and `POST .../knowledge/context` with `access: read`) take any caller. A session caller of the thread route reads only its task and the parent tasks: the same `SessionManager.readableTask` as the `thread` tool (code review: no logic in a transport).
   Alternative: a person token in a file: the agent runs as the same OS user and can read it.

6. **Peer process check.** awd reads the file descriptor of the accepted socket (`socket._handle.fd`).
   - macOS: `lsof -nP -U -a -p <awd pid> -d <fd> -F d` gives the kernel address of the socket. `ps` first gives the processes of the session trees; `lsof -nP -U -a -p <those pids> -F pdn` lists only their Unix sockets with the peer (`n->0x<address>`), so the line with our address names the peer pid, and no line means the caller is not a session process (code review: no listing of each socket of the computer). lsof exits 1 when a listed process has no Unix socket; its output is still used. A check of 1 s or more is logged as a warning.
   - Linux: `readlink /proc/self/fd/<fd>` gives the inode; `ss -xpn` gives the peer inode and its process.
   - `ps -A -o pid=,ppid=` gives the parent chain. A pid whose chain has the pane pid of a running session is a process of that session.
   awd runs the check only when no token came, the route needs it (a person route or a knowledge write), and a session runs on this device. One check takes about 70 ms on macOS (measured). When the check fails (no `lsof` or `ss`, a parse error), awd logs a warning and treats the caller as the person: the check is a second layer after the allow rules and the CLI refusal, and a failed check must not block the person's gate answers. A process that leaves the tree of the session (`setsid`, `nohup … &`, a `launchd` or `systemd-run` job) is not found: SECURITY.md records this risk. Alternative: `SO_PEERCRED`/`LOCAL_PEERPID`: Node has no API, and a native addon for one check is not worth it.

7. **CLI and hooks send the token.** The settings module reads `AW_MCP_TOKEN` (and `AW_MCP_URL` for completeness) into `settings.sessions.session`. `AwClient` gets the option `token` and sends `Authorization: Bearer <token>`; the option `session` and `SESSION_HEADER` go away. `aw-hook` passes the token for `/permission`. The CLI refusal of `HUMAN_COMMANDS` stays as the first layer.

8. **Tools.** One `McpServer` per request from the factory, with the caller from `authInfo`:
   - `thread` {task?, from?, limit? (default 50, at most 200), ancestors?}: the events in merge order, with `next_from` for the next page. One result holds at most about 60,000 JSON characters of events (Claude Code's MCP output limit is about 25k tokens); a page always holds its first event. Each ancestor page has at most `limit` events in the characters left, with its own `next_from`. Only the session task and its ancestors; `readOnlyHint`.
   - `ask` {task?, text, options?}: `SessionManager.ask`; `idempotentHint`.
   - `message`, `stage` {task?, text}: `SessionManager.message|stage`.
   - `artifact_add` {task?, path}, `handoff` {task?, path}: `SessionManager.addArtifact|handoff`; `artifact_add` has `idempotentHint`.
   - `learn` {task?, title, content, shared?}: `KnowledgeService.learn` with the agent caller.
   - Not built yet: `approach`, `ready`, `task_create`, `gate`, `slot_acquire`, `slot_release`, `result`, `done`. Each answers the tool error `not_available` with the task that builds it.
   - Resources: `aw://task` (the fields of the session task), `aw://knowledge` (the knowledge list, at most 200 rows, with the count), and the template `aw://knowledge/{+path}` (one knowledge file). All read-only.
   - `task` is optional and defaults to the session task. Another task gives the tool error `refused`.
   - Each result is one text block with compact JSON. A `ServiceError` becomes a tool result with `isError: true` and the error envelope `{error: {code, message, details?}, trace_id}` (`architecture.md` 8). Another error is logged and becomes `internal`.
   - The server instructions stay under 4,096 characters (a test checks it).

9. **Retry safety.** `phase-1.md` 9.8.4 says Claude Code repeats a call once after a dropped connection. The MCP module keeps the result of each `ask` and `artifact_add` for 60 s by the session and the hash of the arguments. A repeat during the call shares it. After the call, a repeat of `ask` gets the same gate only while the gate is open (a question asked again after an answer is a new question), and the key of `artifact_add` holds the size and the modification time of the file (a test rerun that rewrites the report is a new artifact) (code review). This is a transport concern (the CLI does not repeat a call), so it stays in `daemon/src/mcp/`.

10. **Plugin `.mcp.json`.** Claude Code reads `.mcp.json` at the plugin root as an `mcpServers` map (plugins reference). The file is `{"mcpServers": {"aw": {"type": "http", "url": "${AW_MCP_URL:-http://aw-mcp-url-not-set.invalid/mcp}", "headers": {"Authorization": "Bearer ${AW_MCP_TOKEN:-none}"}}}}`. `phase-1.md` 9.8.3 shows the map without `mcpServers`: the doc is updated. `aw-launch` reads `mcp-token` and `run/mcp.port` and exports `AW_MCP_URL=http://127.0.0.1:<port>/mcp` and `AW_MCP_TOKEN`. With no port file (MCP off, no free port, or a failed MCP start), it exports `AW_MCP_TOKEN` and no `AW_MCP_URL` (code review, high finding: the token is the only agent identity on the local API, so the aw CLI and the PermissionRequest hook need it), and the URL default of `.mcp.json` applies. The contract test reads `plugin.json` and `.mcp.json` and checks the name `aw`, the server key `aw`, the 2 variables and the allow rule.

11. **`aw mcp` stdio fallback: only when spike S12 fails.** `tech-stack.md` 1.1 lists it as "P1, if the spike fails". The real run checks a tool call and a reconnect after an awd restart. When both work, the result handoff records that the fallback is not needed.

12. **Token redaction.** `architecture.md` 6.4.2 puts the token in the redaction set of the event writer. The event writer has no session secret set yet (identity-pairing adds credential redaction). The token never enters an event: it is in a 0600 file, the environment of the agent and the request header. awd never logs the `Authorization` header (a test checks the log). The redaction of the token waits for the redaction set (open issue).

## Risks / Trade-offs
- [Same OS user] The agent can read `~/.aw/sessions/*/mcp-token` of another session and the files of awd. → The allow rules and the CLI refusal are the first layers; the peer check catches a call from the session tree; SECURITY.md records the rest.
- [Peer check cost] `lsof` on a busy Mac can take more time. → Only person routes and knowledge writes, only with a running session, only with no token, and lsof lists only the sockets of the session processes.
- [Port changes after an awd restart] When the last port is taken at the restart, awd takes another port, and a running agent keeps the old URL. → awd tries the last port first; the next resume reads the new port. Phase 1 accepts the rest.
- [Claude Code OAuth behaviour] A future Claude Code version could start OAuth on a 401. → Spike S12 checks 2.1.330; the covered-version check of the adapter gates new versions.
- [Breaking change of the local API] Clients that sent `X-AW-Session` stop working. → No release exists; the CLI and the hook change in the same commit.

## Migration Plan
No release exists. A running session of an older awd gets a token at its next window open (resume). Rollback: revert the commit; the token files stay in the session folders and do nothing.

## Open Questions
- None that block. The token redaction waits for the credential redaction set (identity-pairing).
