/** Prints a new Ed25519 receipt-signing key for RECEIPT_SIGNING_KEY. */
import { generateSigningKeyForEnv } from "@/server/receipts/keys";

const { privateKeyPkcs8, kid } = generateSigningKeyForEnv();
console.log(`# Leash receipt signing key (${kid})\nRECEIPT_SIGNING_KEY=${privateKeyPkcs8}`);
