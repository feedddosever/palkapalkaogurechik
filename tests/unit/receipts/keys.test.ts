import { describe, expect, it } from "vitest";
import { createPublicKey, sign, verify } from "node:crypto";
import { generateSigningKeyForEnv, privateKeyFromSecret } from "@/server/receipts/keys";

const spki = (k: ReturnType<typeof privateKeyFromSecret>) =>
  createPublicKey(k).export({ format: "der", type: "spki" }).toString("base64");

describe("RECEIPT_SIGNING_KEY", () => {
  it("accepts a PKCS#8 key from npm run keys:generate as is", () => {
    const { privateKeyPkcs8 } = generateSigningKeyForEnv();
    const key = privateKeyFromSecret(privateKeyPkcs8);
    expect(key.export({ format: "der", type: "pkcs8" }).toString("base64")).toBe(privateKeyPkcs8);
  });

  it("derives a stable Ed25519 key from a host-generated secret (e.g. Render generateValue)", () => {
    const secret = "B0jrphAPOY7pg92AN0c9MN4yecczLMdwnx4OkA1KFUk=";
    const a = privateKeyFromSecret(secret);
    const b = privateKeyFromSecret(secret);
    expect(a.asymmetricKeyType).toBe("ed25519");
    expect(spki(a)).toBe(spki(b));
    expect(spki(privateKeyFromSecret(`${secret}x`))).not.toBe(spki(a));
    const msg = Buffer.from("receipt");
    expect(verify(null, msg, createPublicKey(a), sign(null, msg, b))).toBe(true);
  });

  it("refuses short secrets", () => {
    expect(() => privateKeyFromSecret("too-short")).toThrow("32+ characters");
  });
});
