import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "@/server/db/client";
import { paypalOperations } from "@/server/db/schema";
import { PayPalError, recordPayPalOp } from "@/server/paypal";
import { provisionWorkspace } from "@/server/workspace";

afterAll(() => closeDb());

describe("recordPayPalOp", () => {
  it("records successful and failed PayPal calls", async () => {
    const { workspaceId } = await provisionWorkspace("demo");
    const db = await getDb();
    const meta = {
      workspaceId,
      op: "capture" as const,
      mode: "sim" as const,
      requestKey: "k1",
      amount: "84.00",
    };

    const ok = await recordPayPalOp(
      db,
      meta,
      async () => ({ captureId: "SIM-C-1", status: "COMPLETED" }),
      (r) => ({ paypalId: r.captureId, status: r.status }),
    );
    expect(ok.captureId).toBe("SIM-C-1");

    await expect(
      recordPayPalOp(
        db,
        { ...meta, requestKey: "k2" },
        async () => {
          throw new PayPalError("AUTHORIZATION_VOIDED", "voided", 422, "dbg-1");
        },
        () => ({ paypalId: "", status: "" }),
      ),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_VOIDED" });

    const rows = await db
      .select()
      .from(paypalOperations)
      .where(eq(paypalOperations.workspaceId, workspaceId));
    expect(rows.map((r) => [r.requestKey, r.status, r.paypalId, r.error, r.debugId]).sort()).toEqual([
      ["k1", "COMPLETED", "SIM-C-1", null, null],
      ["k2", "ERROR", null, "AUTHORIZATION_VOIDED: voided", "dbg-1"],
    ]);
  });
});
