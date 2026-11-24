## ADDED Requirements

### Requirement: KnowledgeStore interface
`@aw/plugin-api` SHALL export the `KnowledgeStore` interface with `list(scope)`, `read(path, version?)`, `write({path, content, base, author, task, kind})`, `history(path)`, `undo(change, by)` and `search(q, {scope, limit})`, and the types of knowledge files, changes, history entries, suggestions, digests and contexts. `@aw/kb-files` SHALL implement it on plain files. A knowledge path SHALL be relative to the `knowledge/` folder and start with `shared/` or `projects/<project>/`.

#### Scenario: List by scope
- **WHEN** the store lists the scope of the project `billing-api`
- **THEN** it returns the files of `projects/billing-api/` with their size, hash, apply mode and last change, and no file of `shared/` or `log/`

### Requirement: Front matter
Each knowledge file SHALL keep its apply mode (`always`, `auto`, `files`, `manual`), `description`, `globs`, `locked` and its provenance (`source`, `author`, `task`, `learned_at`, `validated_at`) in its YAML front matter. The default apply mode SHALL be `always` for a file in `rules/` of a scope, else `auto`. A front matter that is not valid SHALL give the defaults and a `front_matter_error` in the list.

#### Scenario: Rule with no front matter
- **WHEN** `shared/rules/naming.md` has no front matter
- **THEN** the list gives it the apply mode `always`

#### Scenario: Bad front matter
- **WHEN** a file has `apply: sometimes`
- **THEN** the list gives the default mode and a `front_matter_error`, and the other files are listed

### Requirement: History store and copy before write
Before the store writes or removes a knowledge file, it SHALL store the current content in `<AW_HOME>/history/<workspace>/<sha256>` (folder mode 0700, file mode 0600, written once). It SHALL store each new content the same way. Then it SHALL append `knowledge.changed {path, hash, base, author, task, kind}` to `knowledge/log/<device>.jsonl` of this device. A read of a version SHALL check the sha256 of the stored file.

#### Scenario: Write through the store
- **WHEN** `human@macbook-pro` writes new content to `shared/testing.md`
- **THEN** the history store has the old and the new version, and the log of `macbook-pro` has a `knowledge.changed` event with the new hash, the old hash as base and the kind `edit`

#### Scenario: Old base
- **WHEN** a write gives a base that is not the hash of the current file
- **THEN** the store refuses it with a conflict error that has the current hash, and nothing changes

### Requirement: Direct edits and sync changes
`reconcile()` SHALL compare each knowledge file with the last hash that this device saw. A changed hash SHALL be stored in the history. When the newest merged change event of the path has that hash, or an event of another device goes from the seen hash to it, the change SHALL be recorded as seen only (a sync change or an own write). A transition of this device SHALL NOT explain a change, because a person can make the same edit again. An unexplained change or delete SHALL be logged as `knowledge.changed` by `human@<device>` (kind `edit` or `delete`), but only after it stayed unexplained for the settle time (2 s on the clock module).

#### Scenario: Human edit on disk
- **WHEN** a person changes `projects/billing-api/notes.md` with an editor and the settle time passes
- **THEN** the log of this device has an `edit` event by `human@<device>` with the old hash as base, and the history store has both versions

#### Scenario: Change from another device
- **WHEN** sync brings a new version of a file and the log of `ubuntu-01` with its `knowledge.changed` event
- **THEN** this device stores the version and logs no event

#### Scenario: The same edit again by hand
- **WHEN** a person edits a file from version A to B, undoes it, and edits it to B again on the same device
- **THEN** the second edit is logged too

#### Scenario: File before its log line
- **WHEN** a new version arrives and its log line arrives 1 s later
- **THEN** no event of this device is logged

### Requirement: Undo
`undo(change, by)` SHALL restore the base content of the change from the history store as a new change of kind `undo`. A change with the base `null` SHALL remove the file. A base version that is not in the history store SHALL give a not-found error. Undo SHALL work for a change of this device and for a change of another device.

#### Scenario: Undo a learned file
- **WHEN** a person undoes the `learned` change of a new file
- **THEN** the file is removed and the log has an `undo` event with the hash `null`

#### Scenario: Undo a remote change
- **WHEN** `ubuntu-01` changed `shared/testing.md`, sync brought the version, and a person on `macbook-pro` undoes that change
- **THEN** the file has the content from before the change again

### Requirement: Learned entries
`learn` SHALL write each learned item to its own new file `projects/<project>/learned/<YYYY-MM-DD>-<slug>.md` (or `shared/learned/…`), with a suffix when the name exists, the provenance in the front matter (`source: <author> on <key>`, `author`, `task`, `learned_at`), and the kind `learned`. The change entry SHALL have the label "Learned by <author> on <key>".

#### Scenario: Two items with the same title
- **WHEN** an agent learns 2 items with the title "Reset the DB" on the same day
- **THEN** the store writes 2 files, the second with the suffix `-2`

### Requirement: Approval suggestions
A change by an author that is not `human@…` or `aw@…` SHALL become a suggestion when its path is in `rules/` of a scope (`rule`), the current file has `locked: true` (`locked`), the path is in `shared/` (`shared`), or it comes from the message of another person (`other_person`). The store SHALL write no file and SHALL append `knowledge.suggested` with the redacted content (at most 48 KiB) and the reasons. A human SHALL accept it (the store applies the content with `suggestion` in `knowledge.changed`, then appends `knowledge.suggestion_resolved`) or reject it. Accept SHALL refuse with a conflict when the file changed after the suggestion, unless forced. The first resolution in merge order SHALL win.

#### Scenario: Agent edits a locked file
- **WHEN** `claude@ubuntu-01` writes `shared/rules/testing.md`, which has `locked: true`
- **THEN** the file does not change and a pending suggestion has the reasons `rule`, `locked` and `shared`

#### Scenario: Accept a suggestion
- **WHEN** a person accepts a pending suggestion
- **THEN** the file has the suggested content, the change has the suggestion id and the agent as author, and the suggestion is accepted

### Requirement: Daily digest
`digest(date)` SHALL give the agent changes of the UTC date (learned items and other changes, each with its change id for Undo), the pending suggestions, and a text like "Agents learned 4 things. 1 change waits for approval.".

#### Scenario: One learned item and one suggestion
- **WHEN** an agent learned 1 item today and 1 suggestion is pending
- **THEN** the text is "Agents learned 1 thing. 1 change waits for approval."

### Requirement: Session context
`buildContext` SHALL select the shared files and the files of the task's project. "Read now" SHALL have the rules, the `always` files, the `manual` files that the title or the first message names, and the `files` files with a glob that matches a task path. "Read when relevant" SHALL list the `auto` files with their description, and "Read before you change matching files" SHALL list the other `files` files with their globs. When the size of "Read now" is over the load limit (default 40,000 characters), it SHALL drop files in the reverse priority order and give a warning for each dropped file. The text SHALL be at most 9,000 characters; a list that does not fit SHALL end with a warning line and the count of the files that are not listed.

#### Scenario: Over the budget
- **WHEN** the "Read now" files are 52,000 characters and the limit is 40,000
- **THEN** the context drops the files of the lowest priority until the sum fits, and each dropped file has a warning with its size and the limit

#### Scenario: Files mode
- **WHEN** a file has `apply: files` and `globs: ["src/api/**"]`, and the task path is `src/api/invoice.ts`
- **THEN** the file is in "Read now"

### Requirement: Knowledge redaction
The store SHALL redact each credential value of its secrets in each content that it writes, before it computes the hash, and in each suggestion. When a direct edit holds a credential value, the store SHALL write the redacted text back and SHALL store and log only the redacted version.

#### Scenario: Agent learns a secret
- **WHEN** an agent learns an item with the secret value of `stripe-test` in it
- **THEN** the file, the stored version and the log line have `[redacted:stripe-test]`, and the value is in none of them

### Requirement: Search
`search(q, {scope, limit})` SHALL return the files whose path or text has each term of the query (any letter case), with a score and the first matching line, sorted by score.

#### Scenario: Two terms
- **WHEN** a person searches "invoice reset"
- **THEN** each result has both words, and the result with more matches is first
