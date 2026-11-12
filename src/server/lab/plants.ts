import { and, asc, eq } from "drizzle-orm";
import { readProductPage } from "@/server/catalog";
import type { DB } from "@/server/db/client";
import * as t from "@/server/db/schema";

/**
 * A product page as seen from inside one workspace: the supplier's page plus any text an Attack
 * Lab visitor planted on it for that lab run only. Everything here is UNTRUSTED.
 */
export async function productPageFor(db: DB, workspaceId: string, productId: string): Promise<string | null> {
  const base = readProductPage(productId);
  if (base === null) return null;
  const plants = await db
    .select({ text: t.labPlants.text })
    .from(t.labPlants)
    .where(and(eq(t.labPlants.workspaceId, workspaceId), eq(t.labPlants.productId, productId)))
    .orderBy(asc(t.labPlants.createdAt));
  return plants.length ? [base, ...plants.map((p) => p.text)].join("\n") : base;
}
