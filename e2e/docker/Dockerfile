# One image for each e2e device: awd, the aw CLI and the pinned sync engine (docs/phase-1.md 11).
# Build from the repository root: docker compose -f e2e/compose.yaml build
FROM node:26.13.1-bookworm-slim

# procps: ps for the engine supervisor (exact pids). ca-certificates: the engine download.
# git and tmux: the agent sessions (the worktree and the session host).
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git procps tmux \
  && rm -rf /var/lib/apt/lists/*
# Node 25 and later ship no corepack: install the pinned one from npm.
RUN npm install -g corepack@0.34.6 && corepack enable

WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter "@aw/daemon..." --filter "@aw/e2e..."

# The pinned engine, with the sha256 check of the fetch script.
RUN arch="$(dpkg --print-architecture)" \
  && case "$arch" in amd64) platform=linux-x64 ;; arm64) platform=linux-arm64 ;; *) exit 1 ;; esac \
  && node plugins/sync-syncthing/scripts/engine.ts fetch --platform "$platform" --dest /opt/aw-engine

RUN printf '#!/bin/sh\nexec node /repo/daemon/src/bin/aw.ts "$@"\n' > /usr/local/bin/aw \
  && chmod 755 /usr/local/bin/aw \
  && mkdir -p /aw /remote \
  && chown node:node /aw /remote

# awd and the engine run as a normal user, as on a computer of a person. Sessions use the fake
# agent: an e2e run never calls a paid model.
USER node

ENV AW_HOME=/aw/state \
  AW_SYNC_ENGINE=/opt/aw-engine/syncthing \
  AW_SYNC_LISTEN=tcp://0.0.0.0:22300 \
  AW_SYNC_COMMUNITY=off \
  AW_SYNC_TEST_PEERS=on \
  AW_CLAUDE=/repo/plugins/agent-claude/testing/bin/claude

ENTRYPOINT ["/repo/e2e/docker/entrypoint.sh"]
