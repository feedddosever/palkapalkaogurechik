import type { Metadata } from "next";
import { headers } from "next/headers";
import { connection } from "next/server";
import { Suspense } from "react";
import { Ban, Eye, Plug, ShieldCheck } from "lucide-react";
import { revokeApiKeyAction } from "@/app/actions";
import { ConnectPanel } from "@/components/connect-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { listApiKeys } from "@/server/agents/keys";
import { getDb } from "@/server/db/client";
import { env } from "@/server/env";
import { currentWorkspaceId } from "@/server/views";

export const metadata: Metadata = { title: "Connect an agent" };

const TOOLS: { name: string; what: string; pays?: boolean }[] = [
  { name: "get_budget", what: "What's left in the PayPal hold, the autonomy level and your rules" },
  { name: "check_inventory", what: "Supplies, par levels and preferred suppliers" },
  { name: "search_products", what: "Supplier offers with a Channel3 market-price check" },
  { name: "read_product_page", what: "A supplier's page (treated as untrusted)" },
  { name: "read_inbox · read_email", what: "Supplier emails and invoices (untrusted)" },
  { name: "request_purchase", what: "Ask Leash to pay for a purchase", pays: true },
  { name: "pay_invoice", what: "Ask Leash to pay an inbox invoice", pays: true },
  { name: "get_request_status", what: "Paid, waiting for you, or blocked, with reasons and the receipt" },
  { name: "finish", what: "End the session with a summary for you" },
];

export default function ConnectPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Connect an agent</h1>
        <p className="text-muted max-w-3xl">
          Bring your own agent: Claude Desktop, Claude Code, any MCP client, or an agent built on
          PayPal&apos;s Agent Toolkit. It gets the same tools as Leash&apos;s own agent and meets the same
          guard. It can ask; only Leash can pay.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plug className="text-primary size-4" aria-hidden /> Set up
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Suspense fallback={<Skeleton className="h-80" />}>
              <Setup />
            </Suspense>
          </CardContent>
        </Card>
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>What your agent can do</CardTitle>
              <CardDescription>Over MCP at /api/mcp. No tool sends money anywhere.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-2 text-sm">
                {TOOLS.map((tool) => (
                  <li key={tool.name} className="flex flex-col">
                    <span className="flex items-center gap-2">
                      <code className="font-mono text-xs">{tool.name}</code>
                      {tool.pays ? <Badge tone="primary">goes through the guard</Badge> : null}
                    </span>
                    <span className="text-muted">{tool.what}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Keys</CardTitle>
              <CardDescription>
                Each key acts as your ops agent. Revoking one cuts it off at once.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Suspense fallback={<Skeleton className="h-24" />}>
                <Keys />
              </Suspense>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

async function Setup() {
  await connection();
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  const base = host ? `${proto}://${host}` : env.APP_URL;
  return (
    <div className="flex flex-col gap-4">
      <ConnectPanel base={base} />
      <p className="text-muted flex items-start gap-2 text-xs">
        <ShieldCheck className="text-allow mt-0.5 size-4 shrink-0" aria-hidden />
        Everything an outside agent does appears live in your agent console, and every payment it asks for is
        in the ledger with the guard&apos;s reasons.
      </p>
    </div>
  );
}

async function Keys() {
  await connection();
  const workspaceId = await currentWorkspaceId();
  const keys = await listApiKeys(await getDb(), workspaceId);
  if (keys.length === 0) return <p className="text-muted text-sm">No keys yet.</p>;
  const when = (d: Date) =>
    d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
  return (
    <ul aria-label="API keys" className="divide-border flex flex-col divide-y">
      {keys.map((k) => (
        <li key={k.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
          <div className="flex min-w-0 flex-col">
            <span className="flex items-center gap-2 text-sm font-medium">
              {k.name}
              {k.revokedAt ? <Badge tone="block">revoked</Badge> : null}
            </span>
            <span className="text-muted truncate text-xs">
              <code className="font-mono">{k.prefix}…</code> ·{" "}
              {k.lastUsedAt ? (
                <>
                  <Eye className="inline size-3" aria-hidden /> used {when(k.lastUsedAt)} UTC
                </>
              ) : (
                `created ${when(k.createdAt)} UTC`
              )}
            </span>
          </div>
          {k.revokedAt ? null : (
            <form action={revokeApiKeyAction}>
              <input type="hidden" name="keyId" value={k.id} />
              <Button type="submit" variant="ghost" size="sm" aria-label={`Revoke ${k.name}`}>
                <Ban aria-hidden /> Revoke
              </Button>
            </form>
          )}
        </li>
      ))}
    </ul>
  );
}
