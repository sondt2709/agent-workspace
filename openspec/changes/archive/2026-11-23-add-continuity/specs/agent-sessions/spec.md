## MODIFIED Requirements

### Requirement: Reconcile and resume
At start and every 5 s, awd SHALL match its session records to the tmux panes by the stored pane pid, never by a process search. A session that holds the accepted claim and has no live process SHALL be resumed in a new window with `--resume <uuid>`, the stored launch flags, and a continue message after `--` that names the interrupted step. awd SHALL write `session.resumed`. A forced stop SHALL send SIGTERM to the process group, SIGKILL after 5 s, then SIGKILL to each remaining descendant. A resume SHALL signal no process when the session host does not list the stored pane with the stored pid. A session whose agent has no conversation yet (it stopped before its first prompt, so it has no transcript) SHALL start again with `--session-id` and the first input, not with `--resume`, at most 3 times; such a start SHALL NOT count as a resume.

The resume count SHALL reset only after progress: a Stop or a PostToolUse hook after the window opened, or 10 min alive. A SessionStart alone SHALL NOT reset it. After 2 resumes with no progress, or 5 resumes in one hour, the session SHALL become `failed` with the comment "Resume failed" and the gate "Take over terminal". A dead pane with the exit status 3 (aw-launch: awd was not ready) SHALL open again after 30 s with no count, at most 20 times in a row. When a resume would fail and the agent has no conversation while a prompt reached it before (a lost transcript), awd SHALL start the session again with `--session-id`, the first input and the note "the earlier conversation of this session was lost; read `aw thread <key>`". A resume of a session whose first input never reached the agent SHALL send the first input as the message. Before a resume opens a window, awd SHALL adopt a live window `aw-<task>` whose process has the session id in its arguments, and SHALL stop any other live window with that name.

#### Scenario: Agent process killed
- **WHEN** the claude process of a session gets SIGKILL
- **THEN** awd starts a new window with `--resume` and the same session id, and the first input after SessionStart `resume` is the continue message

#### Scenario: Agent stops before its first prompt
- **WHEN** the agent of a new session exits before SessionStart
- **THEN** awd opens a new window with `--session-id` and the first input, the thread has one `message.human` with source `first`, and no `session.resumed`

#### Scenario: Window gone after a reboot
- **WHEN** the window of a session is gone and its stored pid is now the pid of another program
- **THEN** awd resumes the session, and the other program keeps running

#### Scenario: awd restart with a live session
- **WHEN** awd gets SIGKILL and starts again while the agent runs
- **THEN** the tmux window still runs the same pid, and awd does not resume it

#### Scenario: Crash after SessionStart
- **WHEN** the agent dies after each SessionStart, before any Stop or PostToolUse
- **THEN** the session is `failed` after 2 resumes, not resumed forever

#### Scenario: awd not ready
- **WHEN** the pane of a session ends with the exit status 3
- **THEN** awd opens it again after 30 s, and the resume count does not change

#### Scenario: Lost transcript
- **WHEN** a prompt reached the agent, its transcript is gone, and the resumes fail
- **THEN** awd starts the session with `--session-id`, and the first input with the note about the lost conversation

#### Scenario: Unknown window of the same task
- **WHEN** a live window `aw-<task>` runs the session id that the record does not store
- **THEN** awd adopts that window and opens no second one
