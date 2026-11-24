// The settings of the e2e harness: the only module of e2e/ that reads the environment (AGENTS.md).
// `AW_E2E_IMAGE_TAG` goes to `docker compose` through its own environment (compose.yaml).

export interface E2eSettings {
  /**
   * The compose project name. `AW_E2E_PROJECT` selects another name, so 2 runs of the suite on one
   * computer do not stop the containers of each other. An empty value is not set.
   */
  project: string;
}

export function loadE2eSettings(
  env: Record<string, string | undefined> = process.env,
): E2eSettings {
  return { project: env.AW_E2E_PROJECT || "aw-sync-e2e" };
}
