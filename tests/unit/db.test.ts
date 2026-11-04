import { afterAll, describe, expect, it } from "vitest";
import { closeDb, getDbHandle } from "@/server/db/client";
import { workspaces } from "@/server/db/schema";

describe("db client", () => {
  afterAll(() => closeDb());

  it("connects to embedded PGlite and applies migrations with zero setup", async () => {
    const { db, kind } = await getDbHandle();
    expect(kind).toBe("pglite");
    await db.insert(workspaces).values({ id: "ws_test", name: "Test" });
    const rows = await db.select().from(workspaces);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "ws_test", kind: "demo" });
  });
});
