#!/bin/sh
# Writes the device of this container to config.yaml at the first start, then runs awd.
# AW_E2E_DEVICE and AW_E2E_ROLE come from e2e/compose.yaml.
set -eu
mkdir -p "$AW_HOME"
chmod 700 "$AW_HOME"
if [ ! -f "$AW_HOME/config.yaml" ]; then
  cat > "$AW_HOME/config.yaml" <<YAML
kind: awd-config
schema: 1
device:
  slug: ${AW_E2E_DEVICE}
  name: ${AW_E2E_DEVICE}
  role: ${AW_E2E_ROLE}
workspaces: []
YAML
fi
exec node /repo/daemon/src/bin/awd.ts
