// The engine REST adapter (AGENTS.md: one adapter module per external client). axios on the Unix
// socket of the engine with the API key (docs/tech-stack.md 2.3). The reply types hold only the
// fields that AW reads; the tests run them against the pinned engine (docs/phase-1.md 12).
import axios, { AxiosError, type AxiosInstance } from "axios";
import { z } from "zod";

// Each reply is parsed into a zod schema of the fields that AW reads (docs/engineering-rules.md
// 5.2). The objects stay loose: the engine adds fields, and a folder PUT sends back each field.

const connectionSchema = z.looseObject({
  at: z.string().optional(),
  startedAt: z.string().optional(),
  connected: z.boolean(),
  paused: z.boolean(),
  address: z.string(),
  type: z.string(),
  isLocal: z.boolean().optional(),
  clientVersion: z.string().optional(),
});
export type EngineConnection = z.infer<typeof connectionSchema>;

const completionSchema = z.looseObject({
  completion: z.number(),
  needBytes: z.number(),
  needItems: z.number(),
  needDeletes: z.number(),
  globalItems: z.number(),
  remoteState: z.string(),
  sequence: z.number(),
});
export type EngineCompletion = z.infer<typeof completionSchema>;

const fileInfoSchema = z.looseObject({
  name: z.string(),
  modifiedBy: z.string(),
  deleted: z.boolean().optional(),
  modified: z.string().optional(),
  size: z.number().optional(),
});
export type EngineFileInfo = z.infer<typeof fileInfoSchema>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const eventSchema = z.looseObject({
  id: z.number().int(),
  globalID: z.number().int().optional(),
  time: z.string(),
  type: z.string(),
  // AW reads the data of the object events only (each type of ENGINE_EVENT_TYPES and the disk
  // events); other data is null.
  data: z.unknown().transform((value) => (isRecord(value) ? value : null)),
});
export type EngineEvent = z.infer<typeof eventSchema>;

const deviceConfigSchema = z.looseObject({
  deviceID: z.string(),
  name: z.string(),
  addresses: z.array(z.string()),
  compression: z.string().optional(),
  introducer: z.boolean().optional(),
  autoAcceptFolders: z.boolean().optional(),
  paused: z.boolean().optional(),
});
export type EngineDeviceConfig = z.infer<typeof deviceConfigSchema>;

const folderDeviceSchema = z.looseObject({
  deviceID: z.string(),
  introducedBy: z.string().optional(),
  encryptionPassword: z.string().optional(),
});
export type EngineFolderDevice = z.infer<typeof folderDeviceSchema>;

const versioningSchema = z.looseObject({
  type: z.string(),
  params: z.record(z.string(), z.string()),
  cleanupIntervalS: z.number(),
  fsPath: z.string(),
  fsType: z.string(),
});
export type EngineVersioning = z.infer<typeof versioningSchema>;

const folderConfigSchema = z.looseObject({
  id: z.string(),
  label: z.string(),
  path: z.string(),
  type: z.string(),
  devices: z.array(folderDeviceSchema),
  fsWatcherEnabled: z.boolean(),
  fsWatcherDelayS: z.number(),
  rescanIntervalS: z.number(),
  maxConflicts: z.number(),
  paused: z.boolean().optional(),
  versioning: versioningSchema,
});
export type EngineFolderConfig = z.infer<typeof folderConfigSchema>;

const optionsSchema = z.record(z.string(), z.unknown());
const statusSchema = z.looseObject({ myID: z.string() });
const ignoresSchema = z.looseObject({ ignore: z.array(z.string()).nullable().optional() });
const connectionsSchema = z.looseObject({ connections: z.record(z.string(), connectionSchema) });
const deviceStatsSchema = z.record(z.string(), z.looseObject({ lastSeen: z.string().optional() }));
const pendingDevicesSchema = z.record(
  z.string(),
  z.looseObject({
    time: z.string().optional(),
    name: z.string().optional(),
    address: z.string().optional(),
  }),
);
export type EnginePendingDevices = z.infer<typeof pendingDevicesSchema>;
const pendingFoldersSchema = z.record(
  z.string(),
  z.looseObject({
    offeredBy: z.record(
      z.string(),
      z.looseObject({ time: z.string().optional(), label: z.string().optional() }),
    ),
  }),
);
export type EnginePendingFolders = z.infer<typeof pendingFoldersSchema>;
const fileReplySchema = z.looseObject({
  /** The devices that have the global (newest) version of the file. */
  availability: z
    .array(z.looseObject({ id: z.string() }))
    .nullable()
    .optional(),
  global: fileInfoSchema.nullable().optional(),
  local: fileInfoSchema.nullable().optional(),
});

/** An error of the engine REST API with the HTTP status (0: no reply). */
export class EngineRestError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "EngineRestError";
    this.status = status;
  }
}

/** The events that AW reads (docs/phase-1.md 6.5.1). The Item events are skipped (ST9). */
export const ENGINE_EVENT_TYPES = [
  "StateChanged",
  "FolderSummary",
  "FolderCompletion",
  "DeviceConnected",
  "DeviceDisconnected",
  "DevicePaused",
  "DeviceResumed",
  "FolderErrors",
  "PendingDevicesChanged",
] as const;

export class EngineRest {
  readonly #http: AxiosInstance;

  constructor(options: { socket: string; apiKey: string; timeoutMs?: number }) {
    this.#http = axios.create({
      socketPath: options.socket,
      baseURL: "http://syncthing",
      adapter: "http",
      timeout: options.timeoutMs ?? 30_000,
      headers: { "X-API-Key": options.apiKey },
      // The engine answers text for a few routes; each JSON route is parsed.
      transitional: { silentJSONParsing: true },
    });
  }

  /** A call whose reply AW does not read. */
  async #send(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    url: string,
    options: { params?: Record<string, string | number>; data?: unknown; timeoutMs?: number } = {},
  ): Promise<void> {
    await this.#raw(method, url, options);
  }

  /** A call whose reply is parsed into the schema. */
  async #get<S extends z.ZodType>(
    schema: S,
    url: string,
    options: { params?: Record<string, string | number>; timeoutMs?: number } = {},
  ): Promise<z.output<S>> {
    const reply = await this.#raw("GET", url, options);
    const parsed = schema.safeParse(reply.data);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      throw new EngineRestError(
        `Engine GET ${url} gave a reply that is not valid: ${issues}`,
        reply.status,
      );
    }
    return parsed.data;
  }

  async #raw(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    url: string,
    options: { params?: Record<string, string | number>; data?: unknown; timeoutMs?: number },
  ): Promise<{ data: unknown; status: number }> {
    try {
      const reply = await this.#http.request<unknown>({
        method,
        url,
        ...(options.params ? { params: options.params } : {}),
        ...(options.data === undefined ? {} : { data: options.data }),
        ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
      });
      return { data: reply.data, status: reply.status };
    } catch (error) {
      if (error instanceof AxiosError) {
        const status = error.response?.status ?? 0;
        const body =
          typeof error.response?.data === "string" ? error.response.data.trim().slice(0, 200) : "";
        throw new EngineRestError(
          `Engine ${method} ${url} failed: ${status === 0 ? (error.code ?? error.message) : status}${body ? ` ${body}` : ""}`,
          status,
        );
      }
      throw error;
    }
  }

  async ping(timeoutMs = 2000): Promise<void> {
    await this.#send("GET", "/rest/system/ping", { timeoutMs });
  }

  async myId(): Promise<string> {
    return (await this.#get(statusSchema, "/rest/system/status")).myID;
  }

  options(): Promise<Record<string, unknown>> {
    return this.#get(optionsSchema, "/rest/config/options");
  }

  async patchOptions(patch: Record<string, unknown>): Promise<void> {
    await this.#send("PATCH", "/rest/config/options", { data: patch });
  }

  /** True when the engine applies the last config change only after a restart. */
  async restartRequired(): Promise<boolean> {
    const schema = z.looseObject({ requiresRestart: z.boolean() });
    return (await this.#get(schema, "/rest/config/restart-required")).requiresRestart;
  }

  devices(): Promise<EngineDeviceConfig[]> {
    return this.#get(z.array(deviceConfigSchema), "/rest/config/devices");
  }

  async putDevice(device: EngineDeviceConfig): Promise<void> {
    await this.#send("PUT", `/rest/config/devices/${encodeURIComponent(device.deviceID)}`, {
      data: device,
    });
  }

  async patchDevice(id: string, patch: Partial<EngineDeviceConfig>): Promise<void> {
    await this.#send("PATCH", `/rest/config/devices/${encodeURIComponent(id)}`, { data: patch });
  }

  async deleteDevice(id: string): Promise<void> {
    await this.#send("DELETE", `/rest/config/devices/${encodeURIComponent(id)}`);
  }

  folders(): Promise<EngineFolderConfig[]> {
    return this.#get(z.array(folderConfigSchema), "/rest/config/folders");
  }

  async folder(id: string): Promise<EngineFolderConfig | null> {
    try {
      return await this.#get(folderConfigSchema, `/rest/config/folders/${encodeURIComponent(id)}`);
    } catch (error) {
      if (error instanceof EngineRestError && error.status === 404) return null;
      throw error;
    }
  }

  async putFolder(folder: Partial<EngineFolderConfig> & { id: string }): Promise<void> {
    await this.#send("PUT", `/rest/config/folders/${encodeURIComponent(folder.id)}`, {
      data: folder,
    });
  }

  async deleteFolder(id: string): Promise<void> {
    await this.#send("DELETE", `/rest/config/folders/${encodeURIComponent(id)}`);
  }

  /** The devices that connected and that the engine does not know (pairing). */
  pendingDevices(): Promise<EnginePendingDevices> {
    return this.#get(pendingDevicesSchema, "/rest/cluster/pending/devices");
  }

  /** The folders that known devices offer and that this engine does not have (pairing). */
  pendingFolders(): Promise<EnginePendingFolders> {
    return this.#get(pendingFoldersSchema, "/rest/cluster/pending/folders");
  }

  async deletePendingDevice(device: string): Promise<void> {
    await this.#send("DELETE", "/rest/cluster/pending/devices", { params: { device } });
  }

  async ignores(folder: string): Promise<string[]> {
    const reply = await this.#get(ignoresSchema, "/rest/db/ignores", { params: { folder } });
    return reply.ignore ?? [];
  }

  async setIgnores(folder: string, ignore: string[]): Promise<void> {
    await this.#send("POST", "/rest/db/ignores", { params: { folder }, data: { ignore } });
  }

  /** Scans a folder, or one path in it. The call returns after the scan. */
  async scan(folder: string, sub?: string, timeoutMs = 120_000): Promise<void> {
    await this.#send("POST", "/rest/db/scan", {
      params: { folder, ...(sub === undefined ? {} : { sub }) },
      timeoutMs,
    });
  }

  completion(folder: string, device: string): Promise<EngineCompletion> {
    return this.#get(completionSchema, "/rest/db/completion", { params: { folder, device } });
  }

  async connections(): Promise<Record<string, EngineConnection>> {
    return (await this.#get(connectionsSchema, "/rest/system/connections")).connections;
  }

  async deviceStats(): Promise<Record<string, { lastSeen?: string | undefined }>> {
    return this.#get(deviceStatsSchema, "/rest/stats/device");
  }

  async file(
    folder: string,
    file: string,
  ): Promise<{
    global: EngineFileInfo | null;
    local: EngineFileInfo | null;
    availability: string[];
  }> {
    try {
      const reply = await this.#get(fileReplySchema, "/rest/db/file", { params: { folder, file } });
      return {
        global: reply.global ?? null,
        local: reply.local ?? null,
        availability: (reply.availability ?? []).map((a) => a.id),
      };
    } catch (error) {
      if (error instanceof EngineRestError && error.status === 404) {
        return { global: null, local: null, availability: [] };
      }
      throw error;
    }
  }

  async pause(device?: string): Promise<void> {
    await this.#send("POST", "/rest/system/pause", device ? { params: { device } } : {});
  }

  async resume(device?: string): Promise<void> {
    await this.#send("POST", "/rest/system/resume", device ? { params: { device } } : {});
  }

  /** A long poll of the engine events after `since`. */
  events(since: number, timeoutS: number): Promise<EngineEvent[]> {
    return this.#get(z.array(eventSchema), "/rest/events", {
      params: { since, timeout: timeoutS, events: ENGINE_EVENT_TYPES.join(",") },
      timeoutMs: (timeoutS + 10) * 1000,
    });
  }

  /** A long poll of the disk events (LocalChangeDetected, RemoteChangeDetected) after `since`. */
  diskEvents(since: number, timeoutS: number): Promise<EngineEvent[]> {
    return this.#get(z.array(eventSchema), "/rest/events/disk", {
      params: { since, timeout: timeoutS },
      timeoutMs: (timeoutS + 10) * 1000,
    });
  }
}
