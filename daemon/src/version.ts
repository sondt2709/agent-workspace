// The version of awd and aw: the `version` field of the package. CI sets it at the release.
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  version: string;
};

export const AW_VERSION: string = manifest.version;

/** The major version of the local API. A breaking change of `contracts/openapi.yaml` makes it 2. */
export const API_MAJOR = 1;
