# Decision: repository layout

| Item | Value |
|---|---|
| Date | 2026-11-23 |
| Status | Accepted by the product owner |
| Replaces | The `apps/`, `packages/`, `plugins/`, `test/` layout of `phase-1.md` 11 |

## Decision
The repository root is not a code project. Each deliverable is a top-level folder with its own toolchain. The root keeps only repo-wide files.

```
agent-workspace/
├── .github/  docs/  openspec/  scripts/       repo-wide
├── AGENTS.md  CLAUDE.md  README.md  LICENSE  SECURITY.md  Taskfile.yaml
├── package.json  pnpm-workspace.yaml  pnpm-lock.yaml  .nvmrc
│                                  only to link the TypeScript folders; no code, no build
├── contracts/   language-neutral contract: JSON Schemas (generated), OpenAPI file,
│                fixtures, test vectors. TypeScript and Kotlin tests read them.
├── daemon/      awd + aw CLI
├── desktop/     Electron app (task desktop-shell)
├── shared/      TypeScript libraries: schema, core, plugin-api, client, ui, config
├── plugins/     agent-claude, host-tmux, host-orca, sync-syncthing, kb-files, push-webpush, live-direct
├── e2e/         compose.yaml and the end-to-end tests
└── android/     Gradle Kotlin Multiplatform project: shared/, app/, engine/
```

## Rules
1. The root has no source code and no tool config of one language. TypeScript tool config (tsconfig base, ESLint preset, Prettier, Vitest preset) lives in `shared/config`.
2. The root `package.json` is only the workspace manifest (private, scripts that call the folders).
3. The root `Taskfile.yaml` calls the tasks of each folder (`task check` runs all of them).
4. A folder never imports from another deliverable folder. Shared TypeScript code goes through `shared/`. Kotlin reads only `contracts/`.
5. Later phases add top-level folders (for example `relay/`) or plugins. They do not move existing folders.
