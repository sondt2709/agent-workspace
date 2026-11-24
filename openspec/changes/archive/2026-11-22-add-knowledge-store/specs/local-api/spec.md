## ADDED Requirements

### Requirement: Knowledge routes
The local API SHALL serve the knowledge store of a workspace under `/v1/workspaces/{ws}/knowledge` with the tag `knowledge`, and each route SHALL call one method of the awd knowledge service:
- `GET` (list, with `scope` and `project`), `GET /file?path&version` (read), `PUT /file` (write: `path`, `content`, optional `base`), `GET /history?path`, `POST /changes/{change}/undo`, `GET /search?q&scope&project&limit`.
- `POST /learn` (`task`, `title`, `content`, optional `shared`, `author`, `from_person`), `GET /suggestions?state`, `POST /suggestions/{suggestion}/accept` (`force`, `comment`), `POST /suggestions/{suggestion}/reject` (`comment`).
- `GET /digest?date`, `POST /context` (`task`, `paths`, `load_limit`; a read with a body, so a list of paths has one form).

A write reply SHALL be `{change, suggestion, unchanged}`. A base that differs from the current file SHALL give 409 `conflict` with the current hash in `details`. A path outside the knowledge scopes SHALL give 403 `refused`. A version that is not in the history store SHALL give 404 `not_found`. The API SHALL write as `human@<this device>`. `learn` SHALL accept an `author` only of the form `<agent>@<this device>`, else 400 `invalid_input`.

#### Scenario: Write with an old base
- **WHEN** a client sends `PUT /v1/workspaces/-/knowledge/file` with a `base` that is not the hash of the current file
- **THEN** awd answers 409 `conflict` with the current hash and writes nothing

#### Scenario: Agent author of another device
- **WHEN** a client on `macbook-pro` sends `POST /knowledge/learn` with the author `claude@ubuntu-01`
- **THEN** awd answers 400 `invalid_input`

#### Scenario: Context of a task
- **WHEN** a client sends `POST /v1/workspaces/-/knowledge/context` with the task `AW-7`
- **THEN** the reply has the context text of at most 9,000 characters, the selected files with their mode, the budget and the warnings
