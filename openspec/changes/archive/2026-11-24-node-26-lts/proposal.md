## Why
The project tested Node 24 and Node 26. Node 26 is the current LTS. awd and `aw` run on the system Node of the npm package, not on the Node of Electron. One Node version is enough.

## What Changes
- Use only Node 26 LTS: `.nvmrc` 26.13.1, `engines` `>=26.13` (root and the awd npm package), the e2e image `node:26.13.1-bookworm-slim`, `@types/node` 26.6.
- CI runs the Node checks on ubuntu and macOS with Node 26 only.
- Node 26 ships no corepack: the setup and the e2e image install corepack from npm.
- **BREAKING**: awd and `aw` need Node 26.13 or later.

## Impact
`.github/workflows/ci.yaml`, `.nvmrc`, `package.json`, `daemon/scripts/npm-package.ts`, `e2e/docker/Dockerfile`, `pnpm-workspace.yaml`, README, AGENTS.md, `docs/tech-stack.md`, `docs/engineering-rules.md`.
