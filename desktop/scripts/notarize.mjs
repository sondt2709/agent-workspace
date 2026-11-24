// The afterSign hook of electron-builder (electron-builder.yaml): it notarizes the signed macOS app
// with the App Store Connect API key. With no key (no Apple certificate yet, task signing) or on
// another platform it does nothing. A build script, not the app: it reads its own environment.
import { join } from "node:path";

/**
 * @typedef {{ electronPlatformName: string; appOutDir: string;
 *   packager: { appInfo: { productFilename: string } } }} SignContext
 * @typedef {{ notarized: boolean; reason: string | null }} NotarizeResult
 */

/** The names of the variables that the notarization needs. */
export const NOTARIZE_VARIABLES = ["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"];

/**
 * @param {SignContext} context
 * @param {Record<string, string | undefined>} [env]
 * @param {(options: Record<string, string>) => Promise<void>} [notarizeApp] tests give a fake
 * @returns {Promise<NotarizeResult>}
 */
export default async function notarize(context, env = process.env, notarizeApp) {
  if (context.electronPlatformName !== "darwin") {
    return { notarized: false, reason: "not macOS" };
  }
  const missing = NOTARIZE_VARIABLES.filter((name) => !env[name]);
  if (missing.length > 0) {
    const reason = `no ${missing.join(", ")}`;
    process.stdout.write(`Notarization skipped: ${reason}\n`);
    return { notarized: false, reason };
  }
  const run = notarizeApp ?? (await import("@electron/notarize")).notarize;
  await run({
    appPath: join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`),
    appleApiKey: /** @type {string} */ (env.APPLE_API_KEY),
    appleApiKeyId: /** @type {string} */ (env.APPLE_API_KEY_ID),
    appleApiIssuer: /** @type {string} */ (env.APPLE_API_ISSUER),
  });
  return { notarized: true, reason: null };
}
