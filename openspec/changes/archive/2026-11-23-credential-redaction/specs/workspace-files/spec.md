## MODIFIED Requirements

### Requirement: Redaction
Before the `files` layer writes an event line or a text file of a task, it SHALL replace each credential value of the session with `[redacted:<name>]`. The text files of a task SHALL be the terminal snapshot (`terminal/<device>.txt`), the approach versions (`approach/v<n>.md`) and the artifacts (`artifacts/<device>/…`) whose content is text. A string SHALL be text. A byte array SHALL be text when it is strict UTF-8 and has no NUL byte; the `files` layer SHALL write each other byte array as it is. When the redaction changes nothing, the `files` layer SHALL write the input as it is. `writeFile` SHALL return the written content, so a caller hashes the file that syncs, and `redactText(text)` SHALL give the same redaction for a compare. The other files (sealed files, credential files, schema files, the push file) SHALL be written as they are. It SHALL find the plain, the base64 (standard and URL-safe, also inside a longer base64 text from 6 characters) and the URL-encoded forms of the value (`encodeURIComponent`, RFC 3986, Python `quote`, the form encoding of `URLSearchParams`; upper- and lower-case hex; `%20` or `+`). In an event, it SHALL redact the free text only: each string with no strict format and each key and value that the schema does not know. It SHALL never change the envelope or a field with a strict format (ids, HLC, slugs, hashes, enums), so a short secret cannot break an event.

#### Scenario: Plain value
- **WHEN** an agent reply has the value of the credential `stripe-test`
- **THEN** the log line has `[redacted:stripe-test]` and not the value

#### Scenario: Base64 value
- **WHEN** a hook payload has the base64 form of the value, also inside a longer base64 text
- **THEN** the log line does not have the base64 form of the value

#### Scenario: URL-encoded value
- **WHEN** a URL in a terminal snapshot has the URL-encoded form of the value, also the RFC 3986 or the `URLSearchParams` form that encodes `!'()*`
- **THEN** the log line and the snapshot have `[redacted:stripe-test]` and not the encoded form

#### Scenario: Short secret in a formatted field
- **WHEN** the session has the secret `2026` and writes a gate answer in 2026
- **THEN** the event is written with its HLC and ids unchanged, and the answer text has `[redacted:<name>]`

#### Scenario: Approach version and text artifact
- **WHEN** `writeFile` writes `approach/v1.md` as a string and `artifacts/ubuntu-01/notes.txt` as UTF-8 bytes, each with the value
- **THEN** both files have `[redacted:stripe-test]` and not the value, and `writeFile` returns the redacted content

#### Scenario: Binary artifact
- **WHEN** `writeFile` writes `artifacts/ubuntu-01/image.bin` with bytes that are not UTF-8, or with a NUL byte, and the value inside
- **THEN** the file has the same bytes as the input

#### Scenario: Sealed file
- **WHEN** the phone outbox file or a credential file has bytes that look like the value
- **THEN** the `files` layer writes them as they are
