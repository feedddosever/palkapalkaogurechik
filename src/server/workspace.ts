import { eq } from "drizzle-orm";
import { newId } from "@/lib/ids";
import { getDb } from "@/server/db/client";
import { workspaces } from "@/server/db/schema";
import { seedWorkspace, type SeedResult } from "@/server/seed/seed";

/** The workspace used for local development and the default (non-judge) demo. */
export const DEFAULT_WORKSPACE_ID = "ws_default";

let ensuring: Promise<string> | undefined;

/** Returns the default workspace id, seeding it on first use (zero-setup local runs). */
export function ensureDefaultWorkspace(): Promise<string> {
  ensuring ??= (async () => {
    const db = await getDb();
    const existing = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, DEFAULT_WORKSPACE_ID));
    if (existing.length === 0) {
      await seedWorkspace(db, { workspaceId: DEFAULT_WORKSPACE_ID, name: "Bean There Café" });
    }
    return DEFAULT_WORKSPACE_ID;
  })().catch((err) => {
    ensuring = undefined;
    throw err;
  });
  return ensuring;
}

/** Creates a fresh, isolated, seeded workspace (judge mode, Attack Lab, LeashBench). */
export async function provisionWorkspace(
  kind: "demo" | "sandbox" | "bench" = "demo",
  name?: string,
): Promise<SeedResult> {
  const db = await getDb();
  return seedWorkspace(db, { workspaceId: newId("ws"), kind, name });
}
