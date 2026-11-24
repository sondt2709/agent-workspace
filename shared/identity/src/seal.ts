// Sealing with the age format (task-model decision §4, docs/phase-1.md 10.2; openspec
// add-identity-and-pairing, design decisions 13 and 14).
import { Decrypter, Encrypter, generateX25519Identity, identityToRecipient } from "age-encryption";
import { z } from "zod";
import { fromUtf8, utf8 } from "./encoding.ts";

/** Encrypts bytes or a text to one or more age recipients (`age1…`). */
export async function seal(
  content: Uint8Array | string,
  recipients: string[],
): Promise<Uint8Array> {
  if (recipients.length === 0) throw new Error("Seal needs one recipient or more");
  const encrypter = new Encrypter();
  for (const recipient of recipients) encrypter.addRecipient(recipient);
  return encrypter.encrypt(typeof content === "string" ? utf8(content) : content);
}

/** A file that this identity cannot open, or a damaged file. */
export class OpenError extends Error {
  constructor(message = "The file cannot be opened with the key of this device") {
    super(message);
    this.name = "OpenError";
  }
}

/** Decrypts an age file with an age identity (`AGE-SECRET-KEY-1…`). */
export async function open(file: Uint8Array, identity: string): Promise<Uint8Array> {
  const decrypter = new Decrypter();
  decrypter.addIdentity(identity);
  try {
    return await decrypter.decrypt(file, "uint8array");
  } catch {
    throw new OpenError();
  }
}

export async function openText(file: Uint8Array, identity: string): Promise<string> {
  return fromUtf8(await open(file, identity));
}

/** A new workspace credential key: an age X25519 identity and its recipient. */
export async function newCredentialKey(): Promise<{ identity: string; recipient: string }> {
  const identity = await generateX25519Identity();
  return { identity, recipient: await identityToRecipient(identity) };
}

export async function recipientOf(identity: string): Promise<string> {
  return identityToRecipient(identity);
}

/** The content of a phone outbox file `devices/<phone>/sealed/<id>.age` (docs/phase-1.md 10.2). */
export const sealedCredentialSchema = z.object({
  kind: z.literal("sealed-credential"),
  v: z.literal(1),
  name: z.string().regex(/^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/),
  value: z.string().min(1),
});
export type SealedCredential = z.infer<typeof sealedCredentialSchema>;

/** Seals a credential to the device recipients of each computer, as the phone does. */
export function sealCredential(name: string, value: string, recipients: string[]) {
  const content = sealedCredentialSchema.parse({ kind: "sealed-credential", v: 1, name, value });
  return seal(JSON.stringify(content), recipients);
}

export async function openCredential(
  file: Uint8Array,
  identity: string,
): Promise<SealedCredential> {
  const text = await openText(file, identity);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new OpenError("The sealed file has no valid content");
  }
  const parsed = sealedCredentialSchema.safeParse(json);
  if (!parsed.success) throw new OpenError("The sealed file has no valid content");
  return parsed.data;
}
