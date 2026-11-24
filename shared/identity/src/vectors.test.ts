// The shared identity vectors (openspec add-android-pairing): TypeScript computes the same values
// again, and opens the age files that the Kotlin sealer wrote.
import { hex } from "@scure/base";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ageIdentity, deterministicVectors, vectorsPath } from "../scripts/identity-vectors.ts";
import {
  checkRequest,
  decodePairingCode,
  fromBase64,
  open,
  openCredential,
  PairingCodeError,
  recipientOf,
  verifyRecord,
  type PairingOffer,
  type PairingRequest,
} from "./index.ts";

interface AgeFile {
  name: string;
  file: string;
  size?: number;
  credential?: { name: string; value: string };
}

const vectors = JSON.parse(readFileSync(vectorsPath, "utf8")) as {
  master: { public: string };
  records: { name: string; raw: unknown; valid: boolean }[];
  pairing: {
    offer: PairingOffer;
    code: string;
    request: PairingRequest;
    bad_codes: { name: string; code: string }[];
  };
  age: {
    identities: { secret_hex: string; recipient: string }[];
    typescript_sealed: AgeFile[];
    kotlin_sealed: AgeFile[];
  };
};

const large = (size: number) => Uint8Array.from({ length: size }, (_, i) => i % 251);

describe("identity vectors", () => {
  it("has the values that the script computes from the fixed inputs", async () => {
    const rest: Record<string, unknown> = { ...(vectors as unknown as Record<string, unknown>) };
    delete rest.age;
    expect(rest).toEqual(JSON.parse(JSON.stringify(await deterministicVectors())));
  });

  it("verifies each record as the vectors say", () => {
    const master = fromBase64(vectors.master.public);
    expect(vectors.records.length).toBeGreaterThan(5);
    for (const record of vectors.records) {
      expect(verifyRecord(record.raw, master), record.name).toBe(record.valid);
    }
  });

  it("decodes the code and checks the phone request", () => {
    expect(decodePairingCode(vectors.pairing.code)).toEqual(vectors.pairing.offer);
    expect(checkRequest(vectors.pairing.request, vectors.pairing.offer.secret)).toBe(true);
    for (const bad of vectors.pairing.bad_codes) {
      expect(() => decodePairingCode(bad.code), bad.name).toThrow(PairingCodeError);
    }
  });

  it("opens the files that TypeScript sealed", async () => {
    for (const { secret_hex } of vectors.age.identities) {
      const identity = ageIdentity(hex.decode(secret_hex));
      const [credential, big] = vectors.age.typescript_sealed;
      expect(await openCredential(fromBase64(credential!.file), identity)).toEqual({
        kind: "sealed-credential",
        v: 1,
        ...credential!.credential,
      });
      expect(await open(fromBase64(big!.file), identity)).toEqual(large(big!.size!));
    }
  });

  it("opens the files that the Kotlin sealer wrote", async () => {
    expect(vectors.age.kotlin_sealed.map((k) => k.name)).toEqual(["credential", "large", "empty"]);
    for (const { secret_hex, recipient } of vectors.age.identities) {
      const identity = ageIdentity(hex.decode(secret_hex));
      expect(await recipientOf(identity)).toBe(recipient);
      for (const sealed of vectors.age.kotlin_sealed) {
        expect(sealed.file, sealed.name).not.toBe("");
        const file = fromBase64(sealed.file);
        if (sealed.credential) {
          expect(await openCredential(file, identity), sealed.name).toEqual({
            kind: "sealed-credential",
            v: 1,
            ...sealed.credential,
          });
        } else {
          expect(await open(file, identity), sealed.name).toEqual(large(sealed.size!));
        }
      }
    }
  });
});
