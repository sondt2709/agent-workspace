## MODIFIED Requirements

### Requirement: Credential outbox
The phone SHALL add or replace a credential without the means to read it: it seals the value with age to the X25519 key of each valid, not revoked computer record through the `CredentialSealer` interface and writes the result to `tasks/devices/<phone>/sealed/<id>.age`. The sealed content SHALL be `{"kind":"sealed-credential","v":1,"name":<name>,"value":<value>}`, so `openCredential()` of `shared/identity` opens it. The value SHALL never go to an event, a log or the index, and SHALL never become a `String` in the sealer; the value array and the content bytes SHALL be cleared after the seal. With no paired computer, the screen SHALL say so and SHALL write nothing.

#### Scenario: No paired computer
- **WHEN** the human adds a credential on a phone with no computer record
- **THEN** the phone refuses with "No paired computer can get the credential" and writes no file

#### Scenario: Sealed file
- **WHEN** the age sealer seals the value of `github-token` to 2 computers
- **THEN** the phone writes one file `tasks/devices/<phone>/sealed/<uuidv7>.age` that each computer identity opens, and no event holds the value
