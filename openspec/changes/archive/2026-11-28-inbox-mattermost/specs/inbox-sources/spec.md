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
The collecting awd SHALL read the source every `read_every_s` seconds (default 60). Each conversation SHALL have a read level: `all` (each message), `tagged` (each message of a direct message or a group, a message that mentions the person, a reply in a thread whose root the person wrote) or `off`. The source SHALL have the channel mode `selected` (default) or `all`. A conversation with no level of its own SHALL get `tagged` when it is a direct message or a group. A channel with no level of its own SHALL get `off` in the mode `selected` and `tagged` in the mode `all`. The collector SHALL skip the person's own posts, system posts and deleted posts. It SHALL keep a cursor per conversation in its state folder, so a restart reads no message twice. When the read level of a conversation changes, the collector SHALL read the last day of that conversation again and skip each message that a card or the waiting list already has.

#### Scenario: Mention in a channel
- **WHEN** `~api-team` has the level `tagged` and gets "standup at 10" and "@alex can you review #42?"
- **THEN** only "@alex can you review #42?" goes to the next batch

#### Scenario: Selected channels only
- **WHEN** the channel mode is `selected`, `~api-team` has the level `tagged`, `~random` has no level, and Carson sends a direct message
- **THEN** the collector reads `~api-team` and the direct message, and does not read `~random`

#### Scenario: A new read level

- **WHEN** `~billing` had the level `tagged`, its post "Export CSV fails" was skipped, and the person sets the level `all`
- **THEN** the next read gets "Export CSV fails" from the last day, and no message is added twice

#### Scenario: Restart
- **WHEN** awd restarts after it read 3 posts
- **THEN** the next read gets only the posts after them

### Requirement: Sources page
The desktop app SHALL have the page Sources: the Mattermost box (server, user, credential name, collecting device, the last read and its error), the triage box (agent device, model, schedule, instruction, the last batch, "Pause") and the conversations table (name, kind, projects, read level). The schedule SHALL take any interval from 1 minute to 24 hours as text (for example `15m`, `1h`, `1h30m`), the hours (from, to) and the days. The conversations table SHALL have a search by name, the channel mode ("Selected channels" or "All channels"), and the selected conversations first. A conversation SHALL have zero or more projects. A change SHALL write `source.configured`. The page SHALL show each box once, also after a save.

#### Scenario: Map a channel to projects
- **WHEN** the person selects the projects `billing-api` and `web` for `~billing`
- **THEN** the triage agent gets both projects for each thread of `~billing`, and each new card of `~billing` has one of them or no project

#### Scenario: Map a channel to one project
- **WHEN** the person selects only the project `billing-api` for `~billing`
- **THEN** each new card of `~billing` has the project `billing-api`

#### Scenario: Search a channel
- **WHEN** the account reads 300 conversations and the person types "bill" in the search
- **THEN** the table shows only the conversations whose name has "bill"

#### Scenario: Any interval
- **WHEN** the person types `1h30m` in "Every" and saves
- **THEN** `source.configured` has `triage.every_min` 90

#### Scenario: Save the server
- **WHEN** the person changes the server and saves
- **THEN** the page shows one Mattermost box and one triage box
