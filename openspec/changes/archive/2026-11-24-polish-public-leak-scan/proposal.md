## Why
The repository becomes public (decision 45). The text must not show local paths, the name of a test machine, the owner's own words or account details, or a private workflow. The leak check (`scripts/leakcheck.sh`) finds names, paths, emails and tokens, but not a host name in prose, a quote, or a scenario that copies private work.

## What Changes
- Remove the name of the private test machine from the archived OpenSpec changes ("the Linux test server", "an Android emulator").
- Paraphrase the quotes of the owner in `docs/decisions/` and in archived proposals as product requirements; rename the scenarios "Owner case" (main specs `desktop-app` and `workspace-setup`, archived changes, the case name of `contracts/fixtures/gates/context.json`, test comments).
- `.gitignore`: one `.claude/` line in place of the names of private agent folders.
- `docs/workflow.md` 10: the team-skill column describes a generic team skill, not the steps of a private skill.
- Fixtures: the Orca capture path `/home/user/aw-e2e/aw-test-repo` becomes `/home/user/src/aw-test-repo`; the Claude Code auth capture keeps no personal plan (`max`, `max_20x` become `pro`).
- A path to a local prototype file in an archived task list goes out.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `desktop-app`: a scenario title only ("Owner case" becomes "Analysis before the question").
- `workspace-setup`: a scenario title only ("Owner case" becomes "A checkout in a folder of the organization").

## Impact
Text only: docs, OpenSpec, fixtures, test comments. No code behavior changes. Git history is not changed here: the lead prepares `main`.
