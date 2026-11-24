---
name: aw
description: Agent Workspace (AW) rules for this session. Use it for each question to the human, the approach, ready, the result, subtasks, each message, progress line, artifact and handoff, the knowledge (search it first, learn before done), and to read the original task thread. The human is not at this terminal.
---

# Agent Workspace (AW)

AW started this session for one task. The human is NOT at this terminal. Nobody reads your text output live. The human reads the AW thread on a phone or a desktop app.

## Rules

1. Read the full thread before you act: the MCP tool `thread` (`ancestors: true` for a subtask). It has the original messages, word for word. Long threads come in pages: call it again with `from: next_from`.
2. Ask each question to the human with the MCP tool `ask` (`options` when the answer is a choice, each with a `description`). It returns at once. The human sees only the gate: put the full context of a decision (the options, trade-offs, risks, your recommendation) in `details` of `ask`, or in `aw ask --details-file`. Never write "see the message above".
3. After `ask`, END YOUR TURN. Do not wait, sleep or poll. The answer arrives as your next input. It starts with `[AW answer <gate-id>]`.
4. A message from the human can arrive during your work. It starts with `[AW message <id> from <device>]`. Treat it as the next instruction of the human.
5. A permission request can be denied. Then the next input says `Denied by human@<device>: <reason>`. Follow that reason. "Approved: run it again" means: run the same command again.
6. Do not use `AskUserQuestion` or plan mode to ask the human. AW turns them into gates, but `ask` is clearer. A turn that ends with a question also opens a gate.
7. An input that starts with `[AW resume]` means AW restarted this session. Read it, check the result of the interrupted step, and continue.
8. An input that starts with `[AW notice <id>]` is a notice of AW, for example "Start implementing" or "Subtask AW-13 done". Act on it.
9. The work loop: propose the approach with `approach`, then end your turn. After "Approach v<n> confirmed", run `ready` (with `missing` items when you need more) and end your turn. Implement only after "Start implementing". Post the result with `result` and end your turn. After "Result approved", do your last steps, then `done`.
10. Search the knowledge first. Before you plan or ask, read the "Read now" files of the session context, and look in the resource `aw://knowledge` or run `aw kb search <terms>`. Do not ask the human what the knowledge already says.
11. Before `done`, record what you learned: `learn` with a `title` and a `content` for each new thing (one item per call), or `learn` with `nothing_new: true` when you learned nothing new. Do this in each task.
12. Commit your work on the task branch of this worktree. AW pushes the branch to `origin` at each turn end. Do not push it yourself.

## MCP tools (server `aw`)

- `thread`: read the original thread. `ask`: open the gate "Answer question".
- `message`: write a message to the human. `stage`: update the progress line, for example "Running the tests".
- `artifact_add`: copy a file (a test report, a screenshot) into the task. `handoff`: write the context for the next session from a file.
- `learn`: write what you learned as a new knowledge file (`shared: true` waits for approval), or `nothing_new: true`.
- `approach`, `ready`, `result`, `done`: the work loop. `gate`: a decision with options. `task_create`: a subtask (`from_parent: true` copies the test server, credentials and links).
- Resources: `aw://task` (the task fields), `aw://knowledge` (the knowledge list).

The `task` argument is optional: it is the task of this session. A result with an error code `not_ready` means awd restarts: try once more after 10 s.

## Commands (when the MCP tools are missing or fail)

- `aw thread <TASK> [--ancestors] [--from <n>]`, `aw ask <TASK> "<question>" [--details-file <file.md>] [--option "<label>::<description>"]...`
- `aw message <TASK> "<text>"`, `aw stage <TASK> "<text>"`
- `aw artifact add <TASK> <file>`, `aw handoff <TASK> --file <path>`
- `aw approach <TASK> --file <path>`, `aw ready <TASK> [--missing "<item>"]`, `aw result <TASK> --file <path>`, `aw done <TASK>`
- `aw learn <TASK> --file <path> --title "<title>"`, `aw learn <TASK> --nothing-new`, `aw kb search <terms>`, `aw kb show <path>`
- `aw gate open <TASK> --file <path>`, `aw task create --title "<t>" --first-message-file <path> [--from-parent] [--depends-on <TASK>]`

Run each `aw` command alone, not in a compound command: else it needs a permission.

The file of `artifact_add` and `handoff` must be in your working folder (not a symlink to a file outside it), at most 50 MB. AW copies it to each device of the workspace.

Only these tools and commands run with no permission request. The other `aw` commands (`aw gate answer`, `aw task assign`, ...) belong to the human: awd refuses them for a session.

`<TASK>` is the task key or id of this session. It is in the session context, and in `$AW_TASK`.

## Exit codes

0 ok. 1 refused (for example another task). 2 invalid input. 3 awd is not reachable: wait 10 s and run the command again once.
