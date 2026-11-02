import { connection } from "next/server";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import QRCode from "qrcode";
import {
  BadgeCheck,
  Braces,
  CircleX,
  FileSignature,
  Landmark,
  MessageSquareQuote,
  ShieldCheck,
  ShoppingCart,
} from "lucide-react";
import { Logo } from "@/components/logo";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Timeline, TimelineItem } from "@/components/ui/timeline";
import { VerdictBadge, type Verdict } from "@/components/ui/verdict-badge";
import { formatMoney } from "@/lib/format";
import { layerChip, orderLayers } from "@/lib/layers";
import { getDb } from "@/server/db/client";
import { env } from "@/server/env";
import { categoryLabel } from "@/server/guard/rule-card";
import { verifyReceipt, type ReceiptPayload } from "@/server/receipts/receipts";

export const metadata: Metadata = {
  title: "Verify an intent receipt",
  description: "Check that a payment made by an AI agent traces back to what its owner asked for.",
};

export default function VerifyPage({ params }: PageProps<"/verify/[id]">) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-5 sm:px-6">
        <Link href="/" aria-label="Leash home">
          <Logo />
        </Link>
        <Badge tone="neutral">
          <FileSignature aria-hidden /> Intent receipt
        </Badge>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-16 sm:px-6">
        <Suspense fallback={<ReceiptSkeleton />}>
          <Receipt params={params} />
        </Suspense>
      </main>
    </div>
  );
}

function ReceiptSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy>
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

const short = (s: string, n = 10) => (s.length > 2 * n + 1 ? `${s.slice(0, n)}…${s.slice(-n)}` : s);

function Mono({ children, title }: { children: string; title?: string }) {
  return (
    <code
      title={title ?? children}
      className="bg-surface-muted text-foreground rounded px-1.5 py-0.5 font-mono text-xs break-all"
    >
      {children}
    </code>
  );
}

async function Receipt({ params }: { params: PageProps<"/verify/[id]">["params"] }) {
  await connection();
  const { id } = await params;
  const db = await getDb();
  const { receipt, valid, checks } = await verifyReceipt(db, id);

  if (!receipt) {
    return (
      <Card className="p-8 text-center">
        <CircleX className="text-block mx-auto mb-3 size-8" aria-hidden />
        <h1 className="text-lg font-semibold">Receipt not found</h1>
        <p className="text-muted mt-1 text-sm">There is no Leash receipt with the id {id}.</p>
      </Card>
    );
  }

  const p = receipt.payload as ReceiptPayload;
  const url = `${env.APP_URL}/verify/${encodeURIComponent(id)}`;
  const qr = await QRCode.toString(url, {
    type: "svg",
    margin: 0,
    color: { dark: "#16181d", light: "#ffffff" },
  });
  const issued = new Date(p.issuedAt);

  return (
    <div className="flex flex-col gap-6">
      <section
        className={`flex items-start gap-4 rounded-xl border p-5 ${valid ? "bg-allow-soft border-transparent" : "bg-block-soft border-transparent"}`}
        aria-live="polite"
      >
        {valid ? (
          <BadgeCheck className="text-allow size-8 shrink-0" aria-hidden />
        ) : (
          <CircleX className="text-block size-8 shrink-0" aria-hidden />
        )}
        <div className="flex flex-col gap-1">
          <h1 className={`text-lg font-semibold ${valid ? "text-allow" : "text-block"}`}>
            {valid ? "Verified" : "Verification failed"}
          </h1>
          <p className="text-foreground text-sm">
            {valid
              ? "This payment was made by an AI agent within rules its owner wrote, and nothing on this receipt has been changed since Leash signed it."
              : "This receipt does not match its signature or its place in the history. Treat it as untrustworthy."}
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {checks.map((c) => (
              <li key={c.name}>
                <Badge tone={c.ok ? "allow" : "block"} title={c.detail}>
                  {c.ok ? <ShieldCheck aria-hidden /> : <CircleX aria-hidden />} {c.name}: {c.detail}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <Card>
        <CardContent className="grid gap-6 pt-5 sm:grid-cols-[1fr_auto]">
          <div className="flex flex-col gap-1">
            <span className="text-subtle text-xs font-medium tracking-wide uppercase">
              {p.business.name} · {p.agent.name}
            </span>
            <span className="tabular text-3xl font-semibold tracking-tight">
              {formatMoney(p.cart.amount)}
            </span>
            <span className="text-muted text-sm">
              to {p.cart.supplier} ·{" "}
              {issued.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })}{" "}
              UTC
            </span>
            <span className="text-subtle mt-2 text-xs">
              Receipt <Mono>{p.id}</Mono> · #{p.seq} in this agent&apos;s history
            </span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <div
              className="ring-border size-28 rounded-lg bg-white p-2 ring-1 [&_svg]:size-full"
              role="img"
              aria-label="QR code linking to this receipt"
              dangerouslySetInnerHTML={{ __html: qr }}
            />
            <span className="text-subtle text-xs">Scan to verify</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5">
          <h2 className="mb-4 text-base font-semibold">From the owner&apos;s words to the PayPal payment</h2>
          <Timeline>
            <TimelineItem icon={<MessageSquareQuote />} tone="primary" title="1. What the owner asked for">
              <blockquote className="border-border-strong text-foreground border-l-2 pl-3 italic">
                &ldquo;{p.intent.ownerText}&rdquo;
              </blockquote>
              <p className="mt-2 text-xs">
                Compiled rules v{p.intent.mandateVersion} ·{" "}
                <Mono title={p.intent.policyHash}>{short(p.intent.policyHash, 14)}</Mono>
              </p>
            </TimelineItem>

            <TimelineItem icon={<ShoppingCart />} tone="info" title="2. What the agent asked Leash to pay">
              {p.cart.kind === "invoice" ? (
                <p className="text-foreground">
                  Invoice {p.cart.invoiceNumber} from {p.cart.supplier}
                </p>
              ) : (
                <ul className="text-foreground flex flex-col gap-1">
                  {p.cart.items.map((i) => (
                    <li key={`${i.productId}-${i.name}`} className="flex flex-wrap justify-between gap-x-4">
                      <span>
                        {i.quantity} × {i.name}{" "}
                        <span className="text-subtle">({categoryLabel(i.category)})</span>
                      </span>
                      <span className="tabular">{formatMoney(i.unitPrice)} each</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2">
                Pay to <Mono>{p.cart.payee}</Mono>
              </p>
              <p className="mt-1">Agent&apos;s reason: {p.cart.justification}</p>
            </TimelineItem>

            <TimelineItem icon={<ShieldCheck />} tone="allow" title="3. How Leash decided">
              <div className="flex flex-wrap items-center gap-2">
                {p.decision.approval ? (
                  <Badge tone="allow">
                    <BadgeCheck aria-hidden /> Approved by the owner
                  </Badge>
                ) : (
                  <VerdictBadge verdict={p.decision.verdict as Verdict} />
                )}
                {orderLayers(p.decision.layers).map((l) => {
                  const chip = layerChip(l);
                  return (
                    <Badge key={l.layer} tone={chip.tone}>
                      {chip.label}
                    </Badge>
                  );
                })}
              </div>
              <p className="mt-2">
                Agent autonomy level L{p.decision.autonomyLevel}.{" "}
                {p.decision.approval
                  ? `Approved by the ${p.decision.approval.decidedBy} on ${new Date(p.decision.approval.decidedAt).toUTCString()}.`
                  : "Within the owner's rules, so no approval was needed."}
              </p>
            </TimelineItem>

            <TimelineItem icon={<Landmark />} tone="info" title="4. Where the money moved in PayPal" last>
              <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
                <dt className="text-subtle">Hold (authorization)</dt>
                <dd>
                  <Mono>{p.paypal.authorizationId}</Mono>
                </dd>
                <dt className="text-subtle">Captured from hold</dt>
                <dd>
                  <Mono>{p.paypal.captureId}</Mono>
                </dd>
                <dt className="text-subtle">Paid to supplier (payout)</dt>
                <dd>
                  <Mono>{p.paypal.payoutBatchId}</Mono>
                </dd>
              </dl>
              <p className="mt-2 text-xs">
                {p.paypal.mode === "sandbox" ? "PayPal sandbox." : "PayPal simulator (offline demo)."} The
                capture carries this receipt id as its invoice id, so PayPal and Leash point at each other.
              </p>
            </TimelineItem>
          </Timeline>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3 pt-5 text-sm">
          <h2 className="text-base font-semibold">Signature</h2>
          <dl className="text-muted grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
            <dt>Algorithm</dt>
            <dd className="text-foreground">Ed25519 over canonical JSON</dd>
            <dt>Key</dt>
            <dd>
              <Mono>{receipt.keyId}</Mono>
            </dd>
            <dt>Fingerprint</dt>
            <dd>
              <Mono title={receipt.hash}>{short(receipt.hash, 16)}</Mono>
            </dd>
            <dt>Previous receipt</dt>
            <dd>
              {p.prev ? (
                <Mono title={p.prev}>{short(p.prev, 16)}</Mono>
              ) : (
                <span className="text-foreground">none (first)</span>
              )}
            </dd>
          </dl>
          <div className="flex flex-wrap gap-2">
            <a
              className={buttonClasses({ variant: "secondary", size: "sm" })}
              href={`/api/receipts/${encodeURIComponent(id)}`}
            >
              <Braces aria-hidden /> Signed JSON
            </a>
            <a
              className={buttonClasses({ variant: "ghost", size: "sm" })}
              href="/.well-known/leash-keys.json"
            >
              Public keys
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
