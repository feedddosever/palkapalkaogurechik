"use server";

import { and, desc, eq, inArray } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { newId } from "@/lib/ids";
import { runAgent, type AgentMode } from "@/server/agent/runner";
import { compilePolicy } from "@/server/ai/policy-compiler";
import { getDb } from "@/server/db/client";
import * as t from "@/server/db/schema";
import { policyHash, PolicySchema } from "@/server/guard/policy";
import { diffPolicies, type RuleCard } from "@/server/guard/rule-card";
import { closeCycle, getActiveCycle, startCycle } from "@/server/payments/cycles";
import { decideApproval } from "@/server/payments/service";
import { getPayPal, SimulatedPayPal } from "@/server/paypal";
import { currentWorkspaceId, nextMandateVersion, workspaceBasics } from "@/server/views";

/** Server Actions. Each one re-derives the workspace and checks ownership of what it touches. */

export type CompileState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | {
      status: "ok";
      draftId: string;
      ownerText: string;
      ruleCard: RuleCard;
      assumptions: string[];
      clarifications: string[];
      source: "ai" | "offline";
      changes: string[] | null;
    };

export async function compileRulesAction(_prev: CompileState, formData: FormData): Promise<CompileState> {
  const ownerText = String(formData.get("ownerText") ?? "").trim();
  if (ownerText.length < 15) return { status: "error", message: "Describe your rules in a sentence or two." };
  if (ownerText.length > 2000)
    return { status: "error", message: "Please keep your rules under 2,000 characters." };

  const db = await getDb();
  const workspaceId = await currentWorkspaceId();
  const { agent } = await workspaceBasics(db, workspaceId);
  const suppliers = await db.select().from(t.suppliers).where(eq(t.suppliers.workspaceId, workspaceId));

  let result;
  try {
    result = await compilePolicy(
      ownerText,
      suppliers.map((s) => ({ slug: s.slug, name: s.name, known: s.known })),
    );
  } catch (err) {
    return {
      status: "error",
      message: `Couldn't compile your rules: ${err instanceof Error ? err.message : "unknown error"}`,
    };
  }

  const [active] = await db
    .select()
    .from(t.mandates)
    .where(and(eq(t.mandates.agentId, agent.id), eq(t.mandates.status, "active")))
    .orderBy(desc(t.mandates.version))
    .limit(1);

  // Drafts live on the server: saving activates THIS compiled policy, never one sent by the browser.
  await db.delete(t.mandates).where(and(eq(t.mandates.agentId, agent.id), eq(t.mandates.status, "draft")));
  const draftId = newId("man");
  await db.insert(t.mandates).values({
    id: draftId,
    workspaceId,
    agentId: agent.id,
    version: await nextMandateVersion(db, agent.id),
    ownerText,
    policy: result.policy,
    policyHash: policyHash(result.policy),
    ruleCard: result.ruleCard,
    status: "draft",
  });

  return {
    status: "ok",
    draftId,
    ownerText,
    ruleCard: result.ruleCard,
    assumptions: result.assumptions,
    clarifications: result.clarifications,
    source: result.source,
    changes: active ? diffPolicies(PolicySchema.parse(active.policy), result.policy) : null,
  };
}

/** Activates a compiled draft. With next=fund (onboarding) it then opens the PayPal hold approval. */
export async function saveRulesAction(formData: FormData): Promise<void> {
  const draftId = String(formData.get("draftId") ?? "");
  const next = String(formData.get("next") ?? "");
  const db = await getDb();
  const workspaceId = await currentWorkspaceId();
  const [draft] = await db
    .select()
    .from(t.mandates)
    .where(
      and(
        eq(t.mandates.id, draftId),
        eq(t.mandates.workspaceId, workspaceId),
        eq(t.mandates.status, "draft"),
      ),
    );
  if (!draft) throw new Error("That draft is no longer available. Compile your rules again.");

  await db
    .update(t.mandates)
    .set({ status: "superseded" })
    .where(and(eq(t.mandates.agentId, draft.agentId), eq(t.mandates.status, "active")));
  await db.update(t.mandates).set({ status: "active" }).where(eq(t.mandates.id, draft.id));

  if (next === "fund" && !(await getActiveCycle(db, draft.agentId))) {
    const { approveUrl } = await startCycle(db, { workspaceId, agentId: draft.agentId });
    if (approveUrl) redirect(approveUrl);
  }
  redirect(next === "fund" ? "/app" : "/app/rules?saved=1");
}

/** Opens a new PayPal hold for the agent (when there's no active one). */
export async function fundLeashAction(): Promise<void> {
  const db = await getDb();
  const workspaceId = await currentWorkspaceId();
  const { agent } = await workspaceBasics(db, workspaceId);
  if (await getActiveCycle(db, agent.id)) redirect("/app");
  const { approveUrl } = await startCycle(db, { workspaceId, agentId: agent.id });
  redirect(approveUrl ?? "/app");
}

/** The offline PayPal simulator's checkout buttons. */
export async function simCheckoutAction(formData: FormData): Promise<void> {
  const orderId = String(formData.get("orderId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const paypal = getPayPal();
  if (!(paypal instanceof SimulatedPayPal))
    throw new Error("The simulator is only available in offline mode.");
  const db = await getDb();
  const workspaceId = await currentWorkspaceId();
  const [cycle] = await db
    .select()
    .from(t.cycles)
    .where(and(eq(t.cycles.paypalOrderId, orderId), eq(t.cycles.workspaceId, workspaceId)));
  if (!cycle) throw new Error("Unknown order.");
  if (decision === "approve") {
    const { business } = await workspaceBasics(db, workspaceId);
    await paypal.simApprove(orderId, { email: business.ownerEmail, payerId: "SIMPAYER0001" });
    redirect(`/onboarding/funded?token=${encodeURIComponent(orderId)}`);
  }
  await paypal.simCancel(orderId);
  await db.update(t.cycles).set({ status: "failed" }).where(eq(t.cycles.id, cycle.id));
  redirect("/onboarding?cancelled=1");
}

export async function runAgentAction(formData: FormData): Promise<void> {
  const mode: AgentMode = formData.get("mode") === "compromised" ? "compromised" : "standard";
  const db = await getDb();
  const workspaceId = await currentWorkspaceId();
  const { agent } = await workspaceBasics(db, workspaceId);
  const [running] = await db
    .select({ id: t.agentRuns.id })
    .from(t.agentRuns)
    .where(and(eq(t.agentRuns.agentId, agent.id), inArray(t.agentRuns.status, ["running"])));
  if (running) redirect(`/app/runs/${running.id}`);
  const runId = newId("run");
  after(async () => {
    await runAgent(await getDb(), { workspaceId, agentId: agent.id, mode, runId });
  });
  redirect(`/app/runs/${runId}`);
}

export async function decideApprovalAction(formData: FormData): Promise<void> {
  const approvalId = String(formData.get("approvalId") ?? "");
  const decision = formData.get("decision") === "approve" ? "approve" : "deny";
  const returnTo = String(formData.get("returnTo") ?? `/approve/${approvalId}`);
  const db = await getDb();
  await decideApproval(db, approvalId, { decision, decidedBy: "Dana (owner)" });
  if (returnTo.startsWith("/")) redirect(returnTo);
  refresh();
}

/** Ends the week: voids whatever is left of the PayPal hold. */
export async function endWeekAction(): Promise<void> {
  const db = await getDb();
  const workspaceId = await currentWorkspaceId();
  const { agent } = await workspaceBasics(db, workspaceId);
  const cycle = await getActiveCycle(db, agent.id);
  if (cycle) await closeCycle(db, cycle.id);
  refresh();
}
