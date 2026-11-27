## ADDED Requirements

### Requirement: Source plugin
AW SHALL read messages only through a source plugin that implements `Source` of `shared/plugin-api` (`me`, `conversations`, `collect`, `post`, `findPending`). The plugin `source-mattermost` SHALL use the Mattermost REST API v4 through `@mattermost/client` with a personal access token. The token SHALL be an AW credential; awd SHALL read its value only on the collecting device and SHALL never write it to an event, a log line or a screen.

#### Scenario: Connect
- **WHEN** the person saves the server `https://chat.example.com` and the credential `mattermost-alex`
- **THEN** awd calls `GET /api/v4/users/me` with the token and the Sources page shows "connected as @alex"

#### Scenario: Bad token
- **WHEN** the server answers 401
- **THEN** the Sources page shows "The token is not valid. Replace the credential mattermost-alex." and the collector reads nothing

### Requirement: One collecting device
The source configuration SHALL name one collecting device: a computer (role `local` or `remote`). Only the awd of that device SHALL read the source and run the triage session. The phone SHALL never read the source. When the person selects another device, the old device SHALL stop at its next merge, and the new device SHALL start from 1 day before now and skip each message that a card already has.

#### Scenario: Move to the remote device
- **WHEN** MacBook Pro collects and the person selects `ubuntu-01` as the collecting device
- **THEN** MacBook Pro stops its collector and triage session, ubuntu-01 starts them, and no card is added twice

#### Scenario: Phone is not a choice
- **WHEN** the person opens the list of collecting devices
- **THEN** the list has only the computers of the workspace

### Requirement: Collect with read levels
The collecting awd SHALL read the source every `read_every_s` seconds (default 60). Each conversation SHALL have a read level: `all` (each message), `mentions` (each message of a direct message or a group, a message that mentions the person, a reply in a thread whose root the person wrote) or `off`. A new conversation SHALL get the default level `mentions`. The collector SHALL skip the person's own posts, system posts and deleted posts. It SHALL keep a cursor per conversation in its state folder, so a restart reads no message twice. When the read level of a conversation changes, the collector SHALL read the last day of that conversation again and skip each message that a card or the waiting list already has.

#### Scenario: Mention in a channel
- **WHEN** `~api-team` has the level `mentions` and gets "standup at 10" and "@alex can you review #42?"
- **THEN** only "@alex can you review #42?" goes to the next batch

#### Scenario: A new read level

- **WHEN** `~billing` had the level `mentions`, its post "Export CSV fails" was skipped, and the person sets the level `all`
- **THEN** the next read gets "Export CSV fails" from the last day, and no message is added twice

#### Scenario: Restart
- **WHEN** awd restarts after it read 3 posts
- **THEN** the next read gets only the posts after them

### Requirement: Sources page
The desktop app SHALL have the page Sources: the Mattermost box (server, user, credential name, collecting device, read interval, the last read and its error), the triage box (agent device, model, schedule, instruction, the last batch, "Open session", "Pause") and the conversations table (name, kind, project, read level). A change SHALL write `source.configured`. The phone SHALL show the same data read-only.

#### Scenario: Map a channel to a project
- **WHEN** the person selects the project `billing-api` for `~billing`
- **THEN** each new card of `~billing` has the project `billing-api`
