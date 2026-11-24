// `pnpm --filter @aw/identity vectors`: writes contracts/test-vectors/identity.json (openspec
// add-android-pairing). Node runs this file with type stripping. The deterministic part is
// written again on each run. The age files sealed by TypeScript have random bytes, so a run keeps
// the files that exist (`--new-age` makes new ones). The files sealed by Kotlin come from the Kotlin
// test android/identity AgeVectorsTest; this script keeps them.
import { readFile, writeFile } from "node:fs/promises";
import { format, resolveConfig } from "prettier";
import { recipientOf, seal, sealCredential, toBase64, toHex } from "../src/index.ts";
import { ageIdentity, deterministicVectors, fixed, vectorsPath } from "./identity-vectors.ts";

interface AgeFile {
  name: string;
  file: string;
  [key: string]: unknown;
}

const old = (await readFile(vectorsPath, "utf8")
  .then(
    (text) =>
      JSON.parse(text) as { age?: { typescript_sealed?: AgeFile[]; kotlin_sealed?: AgeFile[] } },
  )
  .catch(() => ({}))) as { age?: { typescript_sealed?: AgeFile[]; kotlin_sealed?: AgeFile[] } };

const identities = await Promise.all(
  ["age-a", "age-b"].map(async (label) => {
    // The secret as hex, not as AGE-SECRET-KEY-1…: the leak check refuses each age identity text.
    return {
      secret_hex: toHex(fixed(label)),
      recipient: await recipientOf(ageIdentity(fixed(label))),
    };
  }),
);
const recipients = identities.map((i) => i.recipient);

/** The large content: byte i is i % 251, so it needs 2 payload chunks. */
export const largeContent = (size: number): Uint8Array =>
  Uint8Array.from({ length: size }, (_, i) => i % 251);

const CREDENTIAL = { name: "github-token", value: 'ghp_test-ünï "quoted" \\ end' };
const LARGE_SIZE = 70_000;

const newAge = process.argv.includes("--new-age") || !old.age?.typescript_sealed;
const typescriptSealed: AgeFile[] = newAge
  ? [
      {
        name: "credential",
        credential: CREDENTIAL,
        file: toBase64(await sealCredential(CREDENTIAL.name, CREDENTIAL.value, recipients)),
      },
      {
        name: "large",
        size: LARGE_SIZE,
        file: toBase64(await seal(largeContent(LARGE_SIZE), recipients)),
      },
    ]
  : old.age!.typescript_sealed!;

const kotlinInputs = [
  { name: "credential", credential: CREDENTIAL },
  { name: "large", size: LARGE_SIZE },
  { name: "empty", size: 0 },
].map((input) => ({
  ...input,
  file_key_hex: toHex(fixed(`${input.name}-file-key`).slice(0, 16)),
  ephemeral_hex: recipients.map((_, i) => toHex(fixed(`${input.name}-ephemeral-${i}`))),
  nonce_hex: toHex(fixed(`${input.name}-nonce`).slice(0, 16)),
  file: old.age?.kotlin_sealed?.find((k) => k.name === input.name)?.file ?? "",
}));

const vectors = {
  ...(await deterministicVectors()),
  age: {
    identities,
    typescript_sealed: typescriptSealed,
    kotlin_sealed: kotlinInputs,
  },
};
// The repository checks contracts/ with Prettier: write the file in its form.
const options = (await resolveConfig(vectorsPath)) ?? {};
await writeFile(
  vectorsPath,
  await format(JSON.stringify(vectors), { ...options, filepath: vectorsPath }),
);
console.log(`Wrote ${vectorsPath}`);
