## MODIFIED Requirements

### Requirement: CI checks workflow
`.github/workflows/ci.yaml` SHALL run the repository rules, the Node checks on ubuntu and macOS with Node 26 (the current LTS), the dependency audit and the gitleaks scan of the full history. One job named "CI OK" SHALL fail when one of these jobs fails. Each third-party action SHALL be pinned by commit SHA. The workflow SHALL have no release job.

#### Scenario: Workflow syntax
- **WHEN** a contributor runs actionlint on `.github/workflows/*.yaml`
- **THEN** actionlint reports no problem

#### Scenario: One job fails
- **WHEN** one needed job fails
- **THEN** the "CI OK" job fails
