## MODIFIED Requirements

### Requirement: Permission gate
For each PermissionRequest, awd SHALL apply the rules of the task first, else open the gate `approve_command` with a unique request id `p-<uuidv7>` and wait at most 120 s from the gate open, also across retries of the hook and awd restarts. The gate event SHALL hold the tool, a summary and the sha256 of the input, not the input. While awd starts, a request of a running session SHALL get 503, and when awd stops, a waiting request SHALL get 503 at once. "Allow once" and "Allow for this task" SHALL allow; another answer SHALL deny, and awd SHALL also deliver "Denied by human@<device>: <reason>" as the next input. "Allow for this task" SHALL add a rule of the tool and one key: the command of `Bash`, the file of a file tool (`file_path`, `notebook_path` or `path`), else the sha256 of the whole input. A rule SHALL allow only a later call with the same tool and key, so a rule for one Write never allows a Write of another file (final check fc1-9). After 120 s the hook SHALL deny with `interrupt: true`. The gate SHALL stay open after the deny while the agent waits on it: a later "Allow" SHALL allow the next request with the same tool and input once, and awd SHALL deliver "Approved: run it again". The owner device SHALL close the gate with "Denied after <n> s" (n = the timeout in seconds) when its session starts a new turn after the gate opened (a `message.human` of the session that is not the delivery of an `approve_command` gate), or opens another `approve_command` gate more than the timeout after it, and with "Session ended" when its session ends (task-loop "Gates with no session").

#### Scenario: Timeout and late allow
- **WHEN** nobody answers a permission request for 120 s, and later a person answers "Allow once"
- **THEN** the hook denied with `interrupt: true`, awd delivers "Approved: run it again", and the next request with the same input is allowed without a new gate

#### Scenario: awd restarts while a request waits
- **WHEN** a permission request waits, awd restarts, and a person answers "Allow once" after the restart
- **THEN** the hook allows the tool, and the task has one gate "Approve command"

#### Scenario: Large tool input
- **WHEN** the agent asks to write a file with 100 KB of content
- **THEN** the gate "Approve command" opens, and its event has the sha256 of the input and not the input

#### Scenario: Two requests
- **WHEN** 2 permission requests wait and a person answers the second one
- **THEN** only the second request gets the answer

#### Scenario: New turn after the timeout
- **WHEN** nobody answers a permission request for 120 s, and then a person sends the session a message
- **THEN** the owner device resolves the gate with "Denied after 120 s", and a later "Allow once" becomes a late-answer comment

#### Scenario: Parallel requests
- **WHEN** the agent asks for 2 tool calls in the same second and nobody answers
- **THEN** both gates stay open after the deny, until a new turn, another request after 120 s, or the session end
