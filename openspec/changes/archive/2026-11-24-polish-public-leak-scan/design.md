## Context
`scripts/leakcheck.sh` passes with the 19 private terms of `tmp/leakcheck.local` (1430 files). Four readers read the full text of the non-code files: `docs/`, the root files and package metadata, all of `openspec/`, `contracts/`, `e2e/`, each `fixtures/` folder, the Claude plugin and the strings of the test files.

## Decisions
1. **Fix**: a private host name, a local path, a quote of the owner, a personal account value in a capture, and text that copies a private workflow. Replace each with the synthetic examples of `AGENTS.md`.
2. **Keep**: planning references (decision numbers, fix-list ids, review ids) in archived changes. They name no person or company, and an archive is a record. Generic placeholders (`acme`, `example-org`, `/home/user`, `/Users/example`) stay: they are not real.
3. **Keep, listed as not sure** in the result handoff: Syncthing device ids from throwaway test engines in tests and the REST fixture; random runtime ids of the Orca capture; the phone screen sizes of `permissions-default`; "our other projects" in `docs/tech-stack.md`; `@aw-maintainers` in `.github/CODEOWNERS` (a GitHub team that must exist before the push).
4. **Main specs** change only through the deltas of this change (2 scenario titles).
