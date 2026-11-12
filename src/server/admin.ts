import { timingSafeEqual } from "node:crypto";
import { env } from "@/server/env";

/**
 * Operator-only endpoints (running LeashBench on the server) accept CRON_SECRET in the
 * x-leash-admin-token header. Not Authorization, so it can't collide with the MCP endpoint's keys.
 */
export function isAdminRequest(req: Request): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(req.headers.get("x-leash-admin-token") ?? "");
  const want = Buffer.from(secret);
  return given.length === want.length && timingSafeEqual(given, want);
}
