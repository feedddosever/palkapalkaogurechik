import { createPrivateKey, createPublicKey, verify as cryptoVerify } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq, sql } from "drizzle-orm";
import { canonicalJson } from "@/lib/canonical-json";
import { runAgent } from "@/server/agent/runner";
import { closeDb, getDb } from "@/server/db/client";
import * as t from "@/server/db/schema";
import { activateCycle, startCycle } from "@/server/payments/cycles";
import { decideApproval } from "@/server/payments/service";
import { SimulatedPayPal } from "@/server/paypal/simulator";
import { generateSigningKeyForEnv, listPublicKeys } from "@/server/receipts/keys";
import { verifyReceipt, type ReceiptPayload } from "@/server/receipts/receipts";
import { provisionWorkspace } from "@/server/workspace";

const sim = new SimulatedPayPal(getDb, { appUrl: "http://localhost:3000" });
let agentId = "";

beforeAll(async () => {
  const ws = await provisionWorkspace("demo");
  agentId = ws.agentId;
  const db = await getDb();
  const { cycleId, orderId } = await startCycle(db, { workspaceId: ws.workspaceId, agentId, paypal: sim });
  await sim.simApprove(orderId);
  await activateCycle(db, cycleId, { paypal: sim });
  const run = await runAgent(db, { workspaceId: ws.workspaceId, agentId, ai: false, paypal: sim });
  const oat = run.results.find((r) => r.approvalId)!;
  await decideApproval(
    db,
    oat.approvalId!,
    { decision: "approve", decidedBy: "Dana (phone)" },
    { paypal: sim },
  );
});
afterAll(() => closeDb());

async function receipts() {
  const db = await getDb();
  return db.select().from(t.receipts).where(eq(t.receipts.agentId, agentId)).orderBy(asc(t.receipts.seq));
}

describe("signed intent receipts", () => {
  it("issues one chained receipt per executed payment", async () => {
    const rs = await receipts();
    expect(rs.map((r) => (r.payload as ReceiptPayload).cart.amount)).toEqual([
      "84.00",
      "116.00",
      "68.40",
      "141.00",
    ]);
    expect(rs.map((r) => r.seq)).toEqual([1, 2, 3, 4]);
    expect(rs[0].prevHash).toBeNull();
    for (let i = 1; i < rs.length; i++) expect(rs[i].prevHash).toBe(rs[i - 1].hash);
  });

  it("links owner intent, cart, decision and PayPal ids", async () => {
    const [first, , , approved] = await receipts();
    const p = first.payload as ReceiptPayload;
    expect(p.intent.ownerText).toContain("Spend up to $500 a week");
    expect(p.intent.policyHash).toMatch(/^sha256:/);
    expect(p.cart).toMatchObject({
      supplier: "Northside Roasters",
      payee: "billing@northside-roasters.example",
      sources: ["listing:ns-espresso-5lb"],
    });
    expect(p.decision.layers.map((l) => l.layer)).toEqual(["judge", "rules", "scanner"]);
    expect(p.paypal.captureId).toMatch(/^SIM-C-/);
    expect(p.paypal.payoutBatchId).toMatch(/^SIM-P-/);
    expect((approved.payload as ReceiptPayload).decision.approval?.decidedBy).toBe("Dana (phone)");
    // PayPal points back at the receipt: the capture's invoice_id is the receipt id.
    const db = await getDb();
    const [cap] = await db
      .select()
      .from(t.paypalOperations)
      .where(and(eq(t.paypalOperations.op, "capture"), eq(t.paypalOperations.paypalId, p.paypal.captureId)));
    expect((cap.raw as { invoiceId?: string }).invoiceId).toBe(first.id);
  });

  it("verifies untouched receipts", async () => {
    const db = await getDb();
    for (const r of await receipts()) {
      const v = await verifyReceipt(db, r.id);
      expect(v.valid, r.id).toBe(true);
      expect(v.checks.map((c) => c.name)).toEqual(["hash", "signature", "chain"]);
    }
    expect((await verifyReceipt(db, "rcp_missing")).valid).toBe(false);
  });

  it("anyone can verify with only the published public key", async () => {
    const db = await getDb();
    const [r] = await receipts();
    const keys = await listPublicKeys(db);
    const jwk = keys.find((k) => k.kid === r.keyId)!;
    expect(jwk).toMatchObject({ kty: "OKP", crv: "Ed25519", alg: "EdDSA" });
    const pub = createPublicKey({ key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x }, format: "jwk" });
    expect(
      cryptoVerify(null, Buffer.from(canonicalJson(r.payload)), pub, Buffer.from(r.signature, "base64url")),
    ).toBe(true);
  });

  it("detects a changed amount, a forged signature, and a rewritten history", async () => {
    const db = await getDb();
    const [r1, r2, r3] = await receipts();

    await db.execute(
      sql`update receipts set payload = jsonb_set(payload, '{cart,amount}', '"8.40"') where id = ${r3.id}`,
    );
    expect((await verifyReceipt(db, r3.id)).checks.filter((c) => !c.ok).map((c) => c.name)).toEqual([
      "hash",
      "signature",
    ]);

    await db.update(t.receipts).set({ signature: r1.signature }).where(eq(t.receipts.id, r2.id));
    expect((await verifyReceipt(db, r2.id)).checks.find((c) => c.name === "signature")?.ok).toBe(false);

    await db.update(t.receipts).set({ hash: "sha256:rewritten" }).where(eq(t.receipts.id, r1.id));
    const later = await verifyReceipt(db, r2.id);
    expect(later.checks.find((c) => c.name === "chain")?.ok).toBe(false);
  });

  it("generates production keys that Node can load", () => {
    const { privateKeyPkcs8, kid } = generateSigningKeyForEnv();
    expect(kid).toMatch(/^ed25519-[0-9a-f]{16}$/);
    expect(
      createPrivateKey({ key: Buffer.from(privateKeyPkcs8, "base64"), format: "der", type: "pkcs8" })
        .asymmetricKeyType,
    ).toBe("ed25519");
  });
});
