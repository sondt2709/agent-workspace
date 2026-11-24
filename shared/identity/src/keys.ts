// The master key (from the recovery phrase), the user id and the device keys
// (docs/architecture.md 4.1; openspec add-identity-and-pairing, design decisions 2 and 3).
import { ed25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bech32 } from "@scure/base";
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { generateX25519Identity, identityToRecipient } from "age-encryption";
import { z } from "zod";
import { fromBase64, toBase32Lower, toBase64, utf8 } from "./encoding.ts";

/** A key pair of the master key: the secret never leaves the keystore of the device. */
export interface MasterKey {
  secret: Uint8Array;
  public: Uint8Array;
  /** The user id: `u` + base32 of the first 16 bytes of SHA-256 of the public key. */
  user: string;
}

/** The words of a new recovery phrase: 24 (256-bit entropy). */
export const PHRASE_WORDS = 24;

/** A phrase that is not a valid BIP-39 phrase of the English list. */
export class PhraseError extends Error {
  constructor() {
    super("The recovery phrase is not valid: check each word and the word order");
    this.name = "PhraseError";
  }
}

/** Makes a new recovery phrase of 24 words. */
export function newRecoveryPhrase(): string {
  return generateMnemonic(wordlist, 256);
}

/** Normalizes a phrase: lower case, single spaces. */
export function normalizePhrase(phrase: string): string {
  return phrase.trim().toLowerCase().split(/\s+/).join(" ");
}

/** The user id of a master public key. */
export function userIdOf(masterPublic: Uint8Array): string {
  return `u${toBase32Lower(sha256(masterPublic).slice(0, 16))}`;
}

/** The master key of a recovery phrase. The same phrase always gives the same key. */
export function masterFromPhrase(phrase: string): MasterKey {
  const normal = normalizePhrase(phrase);
  if (!validateMnemonic(normal, wordlist)) throw new PhraseError();
  const seed = mnemonicToSeedSync(normal);
  const secret = hkdf(sha256, seed, utf8("aw-master-key-v1"), utf8("ed25519"), 32);
  const pub = ed25519.getPublicKey(secret);
  return { secret, public: pub, user: userIdOf(pub) };
}

/** The keystore form of a device key (JSON). */
export const deviceSecretSchema = z.object({
  v: z.literal(1),
  /** The Ed25519 secret, base64. */
  ed25519: z.base64(),
  /** The age X25519 identity, `AGE-SECRET-KEY-1…`. */
  x25519: z.string().startsWith("AGE-SECRET-KEY-1"),
});
export type DeviceSecret = z.infer<typeof deviceSecretSchema>;

/** A device key with its public keys. */
export interface DeviceKey {
  secret: DeviceSecret;
  /** The Ed25519 public key, base64. */
  ed25519: string;
  /** The X25519 public key, base64 (the record form). */
  x25519: string;
  /** The age recipient of the X25519 key, `age1…`. */
  recipient: string;
}

/** The raw X25519 public key of an age recipient. */
export function recipientToX25519(recipient: string): Uint8Array {
  const decoded = bech32.decodeToBytes(recipient);
  if (decoded.prefix !== "age" || decoded.bytes.length !== 32) {
    throw new Error("The recipient is not an age X25519 recipient");
  }
  return decoded.bytes;
}

/** The age recipient (`age1…`) of a base64 X25519 public key, as a device record has it. */
export function x25519ToRecipient(publicKey: string): string {
  const bytes = fromBase64(publicKey);
  if (bytes.length !== 32) throw new Error("An X25519 public key has 32 bytes");
  return bech32.encode("age", bech32.toWords(bytes), false);
}

/** Opens the public parts of a stored device key. */
export async function deviceKeyOf(secret: DeviceSecret): Promise<DeviceKey> {
  const parsed = deviceSecretSchema.parse(secret);
  const recipient = await identityToRecipient(parsed.x25519);
  return {
    secret: parsed,
    ed25519: toBase64(ed25519.getPublicKey(fromBase64(parsed.ed25519))),
    x25519: toBase64(recipientToX25519(recipient)),
    recipient,
  };
}

/** Makes a new device key: a random Ed25519 secret and an age X25519 identity. */
export async function newDeviceKey(): Promise<DeviceKey> {
  const { secretKey } = ed25519.keygen();
  return deviceKeyOf({
    v: 1,
    ed25519: toBase64(secretKey),
    x25519: await generateX25519Identity(),
  });
}
