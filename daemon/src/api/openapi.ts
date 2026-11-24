// Renders contracts/openapi.yaml from the zod schemas of the routes (design decision 13).
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";
import { createLogger } from "../log.ts";
import { Daemon } from "../service/daemon.ts";
import { loadSettings } from "../settings.ts";
import { createApp } from "./app.ts";

/** The path of the generated file. */
export const API_YAML_PATH = fileURLToPath(
  new URL("../../../contracts/openapi.yaml", import.meta.url),
);

/** The shared Prettier config (`@aw/config`), the same config that `pnpm format:check` uses. */
const PRETTIER_CONFIG = fileURLToPath(import.meta.resolve("@aw/config/prettier"));

/** One route of the app: the method in upper case and the OpenAPI path (`{param}`). */
export interface RouteEntry {
  method: string;
  path: string;
}

/** `/v1/workspaces/:ws` → `/v1/workspaces/{ws}`. */
export function openApiPath(url: string): string {
  return url.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

/** Builds the app with no socket and returns the OpenAPI text and the routes. */
export async function renderOpenApi(): Promise<{ text: string; routes: RouteEntry[] }> {
  // The app needs a daemon object. It never starts, so no file or socket is touched.
  const daemon = new Daemon({
    settings: loadSettings({ AW_HOME: "/nonexistent/aw", HOME: "/nonexistent" }),
    log: createLogger("silent"),
    watch: false,
    heartbeat: false,
  });
  const routes: RouteEntry[] = [];
  const app = await createApp(daemon, {
    onRoute: (route) => {
      for (const method of [route.method].flat()) {
        // fastify adds a HEAD route for each GET route; it is not part of the contract.
        if (method !== "HEAD") routes.push({ method, path: openApiPath(route.url) });
      }
    },
  });
  await app.ready();
  const raw = app.swagger({ yaml: true });
  await app.close();
  const options = (await resolveConfig(API_YAML_PATH, { config: PRETTIER_CONFIG })) ?? {};
  const text = await format(raw, { ...options, parser: "yaml", filepath: API_YAML_PATH });
  return { text, routes };
}
