// The engine config before the first start (docs/phase-1.md 6.1, 6.2). `syncthing generate` turns
// on global discovery, relays, NAT and the reports, and uses the OS host name. So awd replaces
// config.xml before the first `serve`: no third-party traffic before awd reads the switch.
import { execa } from "execa";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface EngineConfigInput {
  /** The engine home, `<AW_HOME>/sync`. */
  home: string;
  /** The Unix socket of the REST API, `<AW_HOME>/run/sync.sock`. */
  socket: string;
  /** The AW device slug: the engine device name. */
  name: string;
  /** The listen address, for example `tcp://0.0.0.0:22300`. */
  listen: string;
}

export interface EngineIdentity {
  deviceId: string;
  apiKey: string;
  /** The REST socket of the config. */
  socket: string;
}

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => XML_ESCAPES[c]!);
}

function unescapeXml(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|apos);/g, (_m, name: string) => {
    const entry = Object.entries(XML_ESCAPES).find(([, escaped]) => escaped === `&${name};`);
    return entry ? entry[0] : _m;
  });
}

/** A new random API key: 32 bytes, base64url. */
export function newApiKey(): string {
  return randomBytes(32).toString("base64url");
}

/** The config.xml of the first start (the table of docs/phase-1.md 6.2). */
export function renderConfig(input: {
  version: string;
  deviceId: string;
  name: string;
  socket: string;
  apiKey: string;
  listen: string;
}): string {
  const e = escapeXml;
  return `<configuration version="${e(input.version)}">
    <device id="${e(input.deviceId)}" name="${e(input.name)}" compression="metadata" introducer="false" skipIntroductionRemovals="false" introducedBy="">
        <address>dynamic</address>
        <paused>false</paused>
        <autoAcceptFolders>false</autoAcceptFolders>
    </device>
    <gui enabled="true" tls="false" sendBasicAuthPrompt="false">
        <address>${e(input.socket)}</address>
        <unixSocketPermissions>0600</unixSocketPermissions>
        <apikey>${e(input.apiKey)}</apikey>
        <theme>default</theme>
    </gui>
    <options>
        <listenAddress>${e(input.listen)}</listenAddress>
        <globalAnnounceEnabled>false</globalAnnounceEnabled>
        <localAnnounceEnabled>false</localAnnounceEnabled>
        <relaysEnabled>false</relaysEnabled>
        <natEnabled>false</natEnabled>
        <urAccepted>-1</urAccepted>
        <crashReportingEnabled>false</crashReportingEnabled>
        <autoUpgradeIntervalH>0</autoUpgradeIntervalH>
        <startBrowser>false</startBrowser>
        <reconnectionIntervalS>60</reconnectionIntervalS>
        <announceLANAddresses>false</announceLANAddresses>
        <stunKeepaliveStartS>0</stunKeepaliveStartS>
    </options>
</configuration>
`;
}

/**
 * Reads the config version, the device id and the API key of a config.xml text. The device id is
 * the one of the AW template (one top-level device). In a config that the engine wrote, the
 * folders list their devices first and the top-level devices are sorted by id, so the id of this
 * device comes from `syncthing device-id` (the certificate), never from this text.
 */
export function readConfigText(text: string): {
  version: string | null;
  deviceId: string | null;
  apiKey: string | null;
  socket: string | null;
} {
  const version = /<configuration version="(\d+)"/.exec(text)?.[1] ?? null;
  // A top-level device has a name; a device of a folder has none.
  const deviceId = /<device id="([A-Z0-9-]{63})" name="/.exec(text)?.[1] ?? null;
  const apiKey = /<gui\b[\s\S]*?<apikey>([^<]*)<\/apikey>/.exec(text)?.[1];
  const socket = /<gui\b[\s\S]*?<address>([^<]*)<\/address>/.exec(text)?.[1];
  return {
    version,
    deviceId,
    apiKey: apiKey === undefined ? null : unescapeXml(apiKey),
    socket: socket === undefined ? null : unescapeXml(socket),
  };
}

/** The value of an element of config.xml, or null. */
function elementText(text: string, name: string): string | null {
  return new RegExp(`<${name}>([^<]*)</${name}>`).exec(text)?.[1] ?? null;
}

/**
 * True when a config.xml text is an AW config of this home: REST on the AW socket, an API key, and
 * the options of the template that awd never turns on (NAT, usage and crash reports, upgrades).
 * The config of `syncthing generate` (GUI on 127.0.0.1:8384, NAT and reports on) is not one: an
 * awd that stopped between `generate` and the rename of the AW config leaves it.
 */
export function isAwConfig(text: string, socket: string): boolean {
  const config = readConfigText(text);
  return (
    config.apiKey !== null &&
    config.apiKey !== "" &&
    config.socket === socket &&
    elementText(text, "natEnabled") === "false" &&
    elementText(text, "crashReportingEnabled") === "false" &&
    elementText(text, "urAccepted") === "-1" &&
    elementText(text, "autoUpgradeIntervalH") === "0"
  );
}

const DEVICE_ID = /^[A-Z0-9]{7}(-[A-Z0-9]{7}){7}$/;

/** The device id of the engine home, from its certificate (`syncthing device-id`). */
export async function engineDeviceId(
  binary: string,
  home: string,
  env: Record<string, string | undefined> = {},
): Promise<string> {
  const { stdout } = await execa(binary, ["device-id", `--home=${home}`], {
    env: { ...env, STNODEFAULTFOLDER: "1" },
    extendEnv: true,
  });
  const deviceId = stdout.trim();
  if (!DEVICE_ID.test(deviceId)) {
    throw new Error(`The engine gave a device id that is not valid: ${deviceId}`);
  }
  return deviceId;
}

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

/**
 * Makes the engine home ready: at the first start, `generate` and then the AW config.xml. At a
 * later start, it reads the API key of the existing AW config.xml. A config.xml that is not an AW
 * config (see isAwConfig) is replaced by the AW template before the engine starts; `generate`
 * keeps an existing certificate, so the device id does not change.
 */
export async function prepareEngineHome(
  binary: string,
  input: EngineConfigInput,
  env: Record<string, string | undefined> = {},
): Promise<EngineIdentity & { created: boolean; replaced: boolean }> {
  const file = join(input.home, "config.xml");
  await mkdir(input.home, { recursive: true, mode: 0o700 });
  await chmod(input.home, 0o700);
  let replaced = false;
  if (await exists(file)) {
    const text = await readFile(file, "utf8");
    const current = readConfigText(text);
    if (isAwConfig(text, input.socket) && current.apiKey) {
      return {
        deviceId: await engineDeviceId(binary, input.home, env),
        apiKey: current.apiKey,
        socket: input.socket,
        created: false,
        replaced: false,
      };
    }
    replaced = true;
  }
  const run = { env: { ...env, STNODEFAULTFOLDER: "1" }, extendEnv: true };
  await execa(binary, ["generate", `--home=${input.home}`, "--no-port-probing"], run);
  const generated = readConfigText(await readFile(file, "utf8"));
  const deviceId = await engineDeviceId(binary, input.home, env);
  const apiKey = newApiKey();
  const text = renderConfig({
    version: generated.version ?? "52",
    deviceId,
    name: input.name,
    socket: input.socket,
    apiKey,
    listen: input.listen,
  });
  const temp = `${file}.aw-new`;
  await writeFile(temp, text, { mode: 0o600 });
  await rename(temp, file);
  return { deviceId, apiKey, socket: input.socket, created: true, replaced };
}
