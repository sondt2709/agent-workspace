## MODIFIED Requirements

### Requirement: Thread
`GET .../tasks/{task}/thread` SHALL return the events of the task in merge order with `applied` and `reason`, `limit` rows (default 200, maximum 1000) after the cursor `after` or from the offset `from`, and the cursor of the next page or null. `newest=true` SHALL return the newest `limit` events, and `before=<cursor>` the `limit` events just before the cursor; each page SHALL stay in merge order. `types=<type>,<type>` SHALL keep only the events of these types. The reply SHALL have `prev`: the cursor of the first event of the page when older events exist, else null. `ancestors=true` SHALL add the threads of the parent tasks first, read with the same values.

#### Scenario: Pages
- **WHEN** a task has 5 events and a client reads pages with `limit=2`
- **THEN** 3 pages return the 5 events once each, in merge order, and the last page has `next: null`

#### Scenario: Newest page
- **WHEN** a task has 1,100 events and a client reads `newest=true&limit=500`
- **THEN** the reply has events 601 to 1,100 in merge order, `next: null`, and `prev` is the cursor of event 601

#### Scenario: Older page
- **WHEN** the client then reads `before=<prev>&limit=500`
- **THEN** the reply has events 101 to 600, and `prev` is the cursor of event 101

#### Scenario: Types
- **WHEN** a client reads `types=gate.opened,result.posted`
- **THEN** the reply has only `gate.opened` and `result.posted` events
