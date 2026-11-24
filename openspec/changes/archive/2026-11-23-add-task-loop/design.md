## Context

The session manager (`daemon/src/sessions/manager.ts`) claims tasks, starts sessions, writes the thread from hooks, resolves gates and delivers texts. The merge (`shared/core/src/merge/task.ts`) folds the stage from `task.stage_changed` and `task.done`. No code writes these events after the first claim. The MCP server lists the loop tools, but they answer `not_available`. `plugins/push-webpush` is an empty package. The phone writes `push.yaml` and reads `vapid_public_key` from the bindings of each computer (android-ui).

## Goals / Non-Goals

**Goals:** the full loop of `docs/workflow.md` 3 and 4 on the session device; the 6 loop tools; push from the gate owner; reminders; the first-assignment fix; credentials through an interface.

**Non-Goals:** test slots (`slot_acquire`, `slot_release`: continuity); usage limits and "Continue after usage limit" (continuity); the "Take over terminal" gate (continuity); UI for decisions; the real credential values (identity-pairing integration); "Approve device" (identity-pairing).

## Decisions

1. **A new folder `daemon/src/loop/`** holds the loop: `TaskLoop` (one per session manager), pure check functions (`ready.ts`, `reminders.ts`), the push service (`push.ts`) and the credential interface (`credentials.ts`). The manager calls the loop at 6 points: after a gate resolution, at a Stop hook, in each check (ready checks, owned-task work), at a claim (first stage, dependencies), at a window open (credentials) and in the delivery list (notices). Reason: the parallel-note rule (small daemon changes), and the check functions are unit-testable with no tmux.

2. **Stages are events of the owner device.** The loop writes `task.stage_changed` with `by: aw@<device>`; the merge needs no new rule. A first claim writes backlog → discuss, or backlog → ready for a subtask with no own approach and a confirmed parent approach.

3. **Notices are `message.sent` by `aw@<device>`.** "Start implementing", "Result approved" and "Subtask AW-13 done" use the same safe delivery as a message, with the prefix `[AW notice <id>]`. The UserPromptSubmit hook writes `message.human` with the new source `notice` and the actor `aw@<device>`. Reason: the delivery is durable over a restart (it counts as delivered only with a `message.human` of its id), and the thread shows "Not delivered yet" until then. The enum value `notice` is new; phase 1 has no release, so no older reader exists.

4. **Answer texts.** "Confirm" of "Confirm approach" delivers `[AW answer <gate>] Confirm` and "Approach v<n> confirmed. Run `aw ready <key>` and end your turn." "Approve" of "Approve result" delivers the answer and "Result approved. Do the last steps of your workflow, then run `aw done <key>` or end your turn." A request for changes delivers the answer and the comment, as before.

5. **Ready.** `ready` writes `task.ready {missing, gates}`. Each missing item opens a `question` gate ("Missing: <item>"), and `gates` lists them. The checks (all on the implementing device, the session device):
   1. the newest applied `task.ready` of this device sorts after the claim of the session, and each of its gates is resolved;
   2. the approach is confirmed, or the task has no own approach and its parent has a confirmed one;
   3. the task has an assignee; 4. no open dependency;
   5. sync: each `knowledge` and `secure` folder of the workspace is in sync with each connected peer. With no sync engine (not installed), the check passes (one device). Else the task gets `task.paused {cause: waiting_for_sync, next_step: "Waiting for sync: knowledge 92 %", needs_human: false}`, written again only when the text changes, and `task.resumed` when the check passes.
   When all pass and the stage is `ready`, the loop writes ready → implement and the notice "Start implementing". "Waiting for sync" uses the engine `completion` percent only for the text; the decision uses `inSync` (the engine percent was wrong in ST8).

6. **Result and Done.** `result` copies the file into `artifacts/<device>/result-<time>.md`, writes `result.posted`, the gate "Approve result" (Approve · Request changes) and implement → review. "Request changes" → implement. After "Approve", the first Stop hook whose turn started with the delivered "Result approved" (a `message.human` with the gate id) writes `task.done`, `session.ended {reason: done}`, and closes the window (state `ended`). `done` works only after an approved result; else `refused`.

7. **Subtasks.** `task_create` creates a task with `parent` = the session task, `by: <agent>@<device>`, the project of the parent by default. `from_parent` copies the test server, the credential names and the links; explicit fields win. The approach is not copied as a field: the first input of a subtask already holds the confirmed approach of its parent (`firstInput`). With the project switch on, the new task gets `<default agent>@<first online device of the project list>` (presence; else the first device). The merge accepts an agent assignment only as the first assignment (fix of the manual-move review); a later agent `task.assigned` is ignored with `assignment_not_allowed`.

8. **Dependencies.** The claim loop starts no session for a task with an open dependency; the ready check also needs none.

9. **Parent notice.** The owner device of a parent writes the notice once per done subtask; the event id comes from `hookEventId(<subtask done time>, "subtask-done/<parent>/<subtask>")`, so a second check (or a restart) finds it. With a running parent session, the notice goes to it. With no running session (ended, stopped or failed) and a parent that is not done, the loop asks the manager for a new session whose first input is the notice and the thread line; the new session record keeps the notice id in `first_delivery`, so the delivery loop does not paste it a second time.

10. **Gate table rules (`reminders.ts`).** A pure function gives the push of each open gate of an owned task: at the open (kinds `question`, `reply`, `confirm_approach`, `approve_command`, `approve_result`, `custom`, `take_over_terminal`, `continue_after_limit`; `assign` only when an agent created the task), and reminders at 1 h and 24 h (`question`, `reply`, `confirm_approach`, `approve_result`, `custom`, `take_over_terminal`), 24 h only (`assign`, `fix_file`, `continue_after_limit`). No push for `approve_knowledge` and `approve_device`. "Assign task" is the "Needs you" reason `assign` with no gate event (an assignment is `task.assigned`, not an answer); its key is the task id. A done task gives a push "Done" once. The sent pushes are in `~/.aw/state/push-<workspace>.json` (0600), so a restart sends no push twice. A gate that opened more than 10 min before the first check after a restart gets no "open" push (only its reminders).

11. **Knowledge gates.** For each pending suggestion of a task owned by this device, the loop opens `approve_knowledge` (Approve · Reject) with a gate id from `hookEventId(<suggestion time>, "knowledge/<suggestion>")`. The owner resolves the gate with the first answer and calls `knowledge.accept` or `knowledge.reject` with the comment (as `human@<this device>`, the knowledge rule). A suggestion resolved another way (`aw kb accept`) resolves the gate with the answer "Approved" or "Rejected" and no answer event. These gates resolve also with no running session.

12. **Fix a file.** The reminder rule exists; no code opens the gate yet: a schema error of a manual edit is a workspace issue with no task, and a gate needs a task log. Open issue for desktop-devices-kb.

13. **Push sender.** `@aw/push-webpush`: `generateVapidKeys()`, `vapidAuthorization(endpoint, keys, subject, now)` (ES256 JWT, `aud` = the endpoint origin, `exp` 12 h), `encrypt(plaintext, p256dh, auth, {salt?, serverKeys?})` (RFC 8291 `aes128gcm`, record size 4096, one record), and `sendPush(subscription, payload, options)` with a `fetch` that a test replaces. The key pair is in `~/.aw/keys/vapid.json` (0600), made at the first awd start. awd writes the public key into `bindings.yaml` of each open workspace when it differs. The sender reads `tasks/devices/*/push.yaml` (schema `push.v1`), takes the subscriptions with `computer: <own slug>` and the current key, and sends `{event, task, key, gate_kind, text}` (at most 3 KB, the text cut) with `TTL: 86400` and `Urgency: high`. A 404 or 410 reply is logged at info (the phone registers again); other failures are logged at warn. No retry (the reminder is the retry).

14. **Credentials.** `CredentialProvider.values(workspace, names)` gives a map of the values it has. The default provider has none (TODO identity-pairing). At each window open, the manager writes each value to `~/.aw/sessions/<session>/credentials/<name>` (0600) and sets `AW_CREDENTIALS_DIR`; a missing value gets one comment per session ("Credential <name> has no value on <device>"). The redaction of these values is the job of the identity integration (`refreshSecrets`).

15. **CLI.** `aw gate open <task> --file` (not `aw gate <task>`): `aw gate` already has the subcommands `list` and `answer`. `aw task create` in a session (AW_SESSION set) calls the session route; `--project` is optional there. The new agent commands go to `AGENT_COMMANDS`: `approach`, `ready`, `result`, `done`, `task create`, `gate open`.

## Risks / Trade-offs

- [The loop runs only where a session manager runs (tmux and the agent found)] → A computer with no agent sends no push and no reminder. Each computer that implements has them; open issue for continuity.
- [Decisions have no answer field] → "Confirm" accepts the recommendations; a change goes in the comment. A UI for choices is later.
- [The knowledge accept acts as `human@<session device>`, not the device of the answer] → the gate answer event keeps the real person.
- [RFC 8291 vectors are fixed in tests, but no real push service was called] → Test later with the emulator and FCM.
