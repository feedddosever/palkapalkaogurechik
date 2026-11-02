import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Leash database schema.
 * Step 1 ships the tenancy root only; the full domain model lands in Step 2.
 * Every domain table carries `workspace_id` so each demo/judge session is isolated.
 */

export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["demo", "sandbox", "bench"] })
    .notNull()
    .default("demo"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
