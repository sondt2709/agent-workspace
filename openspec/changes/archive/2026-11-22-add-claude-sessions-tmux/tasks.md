## 1. Interfaces and plugins

- [x] 1.1 `shared/plugin-api`: `SessionHost`, `AgentRuntimeAdapter`, the hook event types and the launch spec types
- [x] 1.2 `plugins/host-tmux`: binary search (skip `/.orca/`), config file, server start (direct or through `aw-sessions.service`), exec-form windows, `list`, `alive`, `capture`, `paste`, `keys`, process-group `stop`, `close`; tests against a real tmux on a private socket
- [x] 1.3 `plugins/agent-claude/plugin/`: `plugin.json` (`name: aw`), `SKILL.md` (< 6,000 characters), `hooks.json`, `bin/aw`, `bin/aw-hook`; contract test (name, size, allow rule, hook timeouts)
- [x] 1.4 `plugins/agent-claude/src`: adapter (`detect` from `claude --version`, `authStatus` from `claude auth status --json`, launch arguments for new and resume, hook payload parser, transcript path, trust entry with backup and version range); tests with recorded outputs
- [x] 1.5 Fake agent `plugins/agent-claude/src/testing/fake-claude.ts` and `testing/bin/claude`, with the captured payloads and their source

## 2. awd sessions

- [x] 2.1 Settings: `AW_TMUX`, `AW_TMUX_SOCKET`, `AW_CLAUDE`, `AW_CLAUDE_MODEL`, `AW_SESSION`, `AW_TASK`, `AW_WORKSPACE`
- [x] 2.2 `WorkspaceService`: write task events with an actor, a buffered and an immediate path; thread `from` offset
- [x] 2.3 Session records and files in `~/.aw/sessions/<session>/` (0700/0600), first input, context, `launch.json`
- [x] 2.4 `aw-launch` (`daemon/bin/aw-launch`, `daemon/src/bin/aw-launch.ts`): readyz wait, trust entry, env, `execve`
- [x] 2.5 `aw-hook` (`daemon/src/bin/aw-hook.ts`): spool write, SessionStart context, PreToolUse deny with a gate id, PermissionRequest wait and deny after the timeout
- [x] 2.6 Session manager: claim loop, start (worktree, stage Discuss, `session.started`), stop on a move, spool drain, thread events, gates from hooks, reply gate
- [x] 2.7 Log buffer: 1 s for session events, immediate writes flush first
- [x] 2.8 Gate resolution and safe delivery (dialog check, paste, Enter, confirmation, 3 attempts, comment)
- [x] 2.9 Permission gate: rules, one-time approvals, 120 s timeout, deny delivered as input
- [x] 2.10 Reconcile at start and every 5 s; resume with the continue message; forced stop
- [x] 2.11 Daemon wiring: one manager per open workspace; stop keeps the sessions; `/readyz` session host

## 3. API and CLI

- [x] 3.1 Schemas in `shared/client/src/schemas.ts` and client methods for the session routes
- [x] 3.2 Routes in `daemon/src/api/sessions.ts`; `pnpm api:generate`
- [x] 3.3 CLI `daemon/src/cli/agent.ts`: `ask`, `message`, `stage`, `artifact add`, `handoff`, `session list|stop`, `thread --from`
- [x] 3.4 `aw service install`: `aw-sessions.service` on Linux; `AbandonProcessGroup` in the LaunchAgent

## 4. Tests

- [x] 4.1 Unit tests of the buffer, the delivery, the permission waits (fake clock), the hook parser, the first input and the context limit
- [x] 4.2 E2E with awd, tmux and the fake agent: ask, answer from another device, thread (test plan 1)
- [x] 4.3 E2E permission: allow, deny delivered as input, timeout with a short timeout, late allow (test plan 2)
- [x] 4.4 E2E awd SIGKILL with a missed answer; agent SIGKILL and resume with the continue message (test plan 3)
- [x] 4.5 Special characters in the first message; process-group stop with a background command; move stops the session

## 5. Docs and verification

- [x] 5.1 Docs: `phase-1.md` 9, `architecture.md` 4.5, `tech-stack.md` 1.3, `AGENTS.md`, `e2e/README.md` (`workflow.md` 8 already lists these commands)
- [x] 5.2 `task check` passes; break each new test once (mutation script in the evidence folder)
- [x] 5.3 Real Claude Code with haiku on a Linux remote device: plugin loads, `aw ask` gate, answer delivered, `--resume` after kill -9 keeps the session id; clean up
