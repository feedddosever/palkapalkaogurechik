import { newId } from "@/lib/ids";
import { getDb, type DB } from "@/server/db/client";
import { paypalOperations } from "@/server/db/schema";
import { env, features } from "@/server/env";
import { SandboxPayPal } from "./sandbox";
import { SimulatedPayPal } from "./simulator";
import { PayPalError, type PayPalGateway } from "./types";

export * from "./types";
export { SandboxPayPal } from "./sandbox";
export { SimulatedPayPal } from "./simulator";

const globalForPayPal = globalThis as unknown as { __leashPayPal?: PayPalGateway };

/** The PayPal gateway for this process: real sandbox when credentials exist, else the simulator. */
export function getPayPal(): PayPalGateway {
  if (!globalForPayPal.__leashPayPal) {
    globalForPayPal.__leashPayPal = features.paypalLive
      ? new SandboxPayPal({ clientId: env.PAYPAL_CLIENT_ID!, clientSecret: env.PAYPAL_CLIENT_SECRET! })
      : new SimulatedPayPal(getDb, { appUrl: env.APP_URL });
  }
  return globalForPayPal.__leashPayPal;
}

/** Test hook: swap the gateway (e.g. a simulator with a controllable clock). */
export function setPayPalForTesting(gateway: PayPalGateway | undefined): void {
  globalForPayPal.__leashPayPal = gateway;
}

export type PayPalOp = (typeof paypalOperations.$inferInsert)["op"];

/**
 * Runs one PayPal call and records it in `paypal_operations` (success or failure) with the
 * idempotency key, PayPal id, status and debug id, so every cent in the ledger links back to PayPal.
 */
export async function recordPayPalOp<T>(
  db: DB,
  meta: {
    workspaceId: string;
    op: PayPalOp;
    mode: "sandbox" | "sim";
    requestKey: string;
    requestId?: string;
    cycleId?: string;
    amount?: string;
  },
  call: () => Promise<T>,
  describe: (result: T) => { paypalId: string; status: string; debugId?: string },
): Promise<T> {
  try {
    const result = await call();
    const d = describe(result);
    await db.insert(paypalOperations).values({
      id: newId("ppo"),
      workspaceId: meta.workspaceId,
      requestId: meta.requestId,
      cycleId: meta.cycleId,
      op: meta.op,
      mode: meta.mode,
      requestKey: meta.requestKey,
      paypalId: d.paypalId,
      status: d.status,
      amount: meta.amount,
      debugId: d.debugId,
      raw: result as object,
    });
    return result;
  } catch (err) {
    const e = err instanceof PayPalError ? err : new PayPalError("UNKNOWN", String(err));
    await db.insert(paypalOperations).values({
      id: newId("ppo"),
      workspaceId: meta.workspaceId,
      requestId: meta.requestId,
      cycleId: meta.cycleId,
      op: meta.op,
      mode: meta.mode,
      requestKey: meta.requestKey,
      status: "ERROR",
      amount: meta.amount,
      debugId: e.debugId,
      error: `${e.code}: ${e.message}`,
    });
    throw e;
  }
}
