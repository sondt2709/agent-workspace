## ADDED Requirements

### Requirement: Identity, device, pair and credential commands
`aw` SHALL have `identity show|phrase`, `device list|add [--qr]|approve <pairing> <check-code>|revoke <device>`, `pair <code> [--path] [--slug] [--name]` and `credential add <name> [--file <path|->]|list|remove <name>|get <name>`. Each SHALL call the local API and use the exit codes of the CLI. No command SHALL take a credential value or a key as an argument. `aw device add` SHALL print the code, the expiry and, after a request, the check code and the approve command.

#### Scenario: Value from stdin
- **WHEN** `printf 'sk_test_1\n' | aw credential add stripe-test` runs
- **THEN** it exits with 0, `aw credential get stripe-test` prints `sk_test_1`, and the process arguments never had the value
