# push-sender Specification

## Purpose
The Web Push sender of the gate owner computer: one VAPID key per computer, the RFC 8291 encryption and the send to the phone subscriptions of push.yaml (add-task-loop).
## Requirements
### Requirement: VAPID key per computer
Each computer SHALL make one P-256 key pair at its first awd start, keep it in `~/.aw/keys/vapid.json` (mode 0600), and write the public key (uncompressed point, base64url with no padding) as `vapid_public_key` to its own `bindings.yaml` in each open workspace. The `Authorization` header SHALL be `vapid t=<ES256 JWT>, k=<public key>` with `aud` = the origin of the endpoint, `exp` at most 24 h ahead (RFC 8292) and `sub` = `mailto:noreply@example.com` always: no setting names a person. The sent pushes SHALL be recorded in `~/.aw/push/<workspace id>.json`, so a restart sends none twice.

#### Scenario: Key in the bindings
- **WHEN** awd opens a workspace on a computer
- **THEN** its `bindings.yaml` has the `vapid_public_key` of `~/.aw/keys/vapid.json`

### Requirement: RFC 8291 encryption
The sender SHALL encrypt each push with `aes128gcm` (RFC 8291 and RFC 8188, one record) to the `p256dh` and `auth` of the subscription. With the keys and the salt of RFC 8291 appendix A, it SHALL give the body of that appendix.

#### Scenario: Test vector
- **WHEN** the test encrypts "When I grow up, I want to be a watermelon" with the appendix A values
- **THEN** the body is equal to the appendix A body

### Requirement: Send to the phone subscriptions
For a push, the owner device SHALL read `tasks/devices/*/push.yaml` (schema `push.v1`), take each subscription with `computer` = its own slug and `vapid_public_key` = its current key, and POST the encrypted JSON `{event, task, key, kind, gate_kind, text}` (at most 3 KB) with `TTL: 86400`, `Urgency: high` and `Content-Encoding: aes128gcm`. `kind` SHALL be `gate` for a gate push or an "Assign task" push, `done` for the push of a Done task, `login_expired` for an expired agent login, and `login_ends` for a login that ends soon. `gate_kind` SHALL be null when `kind` is not `gate`. It SHALL send only to a device that has a kept record with the role `mobile` in the workspace that is not revoked, and whose device key and sync device id have no revoked record in any open workspace. A failed send SHALL be logged and SHALL not stop the loop.

#### Scenario: Old key
- **WHEN** the subscription of a phone has another `vapid_public_key`
- **THEN** the computer sends nothing to it

#### Scenario: Revoked phone
- **WHEN** the record of `pixel-9` is revoked in this workspace or in another open workspace
- **THEN** the computer sends no push to the subscriptions of `pixel-9`

#### Scenario: No record
- **WHEN** `tasks/devices/pixel-8/push.yaml` exists and the workspace has no record of `pixel-8`
- **THEN** the computer sends nothing to it

#### Scenario: push.yaml under a computer
- **WHEN** a revoked phone writes its subscription to `tasks/devices/ubuntu-01/push.yaml`, and `ubuntu-01` has a valid record with the role `remote`
- **THEN** the computer sends nothing to it

#### Scenario: Done push
- **WHEN** AW-12 becomes Done on its owner device
- **THEN** the preview is `{event: null, task, key: "AW-12", kind: "done", gate_kind: null, text: "Done: <title>"}`

#### Scenario: Login expired push
- **WHEN** the agent login of the session device of AW-12 expired
- **THEN** the preview has `kind: "login_expired"` and `gate_kind: null`

### Requirement: Question push keeps the question line
The push preview and the desktop notification of a question gate SHALL use the gate title (the question), and SHALL NOT have the details.

#### Scenario: Question with details
- **WHEN** the agent asks "Which queue library?" with 2 KiB of details
- **THEN** the push text is "Which queue library?" and has no line of the details

