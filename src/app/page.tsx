import { connection } from "next/server";
import { Suspense } from "react";
import { BadgeCheck, Fingerprint, Gauge, ShieldCheck } from "lucide-react";
import { LeashMeter } from "@/components/leash-meter";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Timeline, TimelineItem } from "@/components/ui/timeline";
import { VerdictBadge } from "@/components/ui/verdict-badge";
import { publicFeatureSnapshot, type Features } from "@/server/env";

const principles = [
  {
    icon: ShieldCheck,
    title: "The agent can ask. Only Leash can pay.",
    body: "Your agent never holds PayPal credentials. Every payment request passes rules, an injection scanner and an AI judge.",
  },
  {
    icon: Gauge,
    title: "Trust is earned.",
    body: "Autonomy levels L0–L4. A clean track record lengthens the leash; a blocked attack shortens it instantly.",
  },
  {
    icon: Fingerprint,
    title: "Every cent is traceable.",
    body: "Each payment carries a signed intent receipt that links your words to the cart, the decision and the PayPal capture.",
  },
];

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-16 px-4 pt-8 pb-20 sm:px-6 sm:pt-14">
        <section className="grid items-center gap-10 lg:grid-cols-[1.1fr_1fr]">
          <div className="flex flex-col gap-6">
            <Badge tone="primary" className="self-start">
              Built for the PayPal + AI hackathon
            </Badge>
            <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              Let your AI agent spend.
              <span className="text-primary block">Safely, on PayPal.</span>
            </h1>
            <p className="text-muted max-w-xl text-lg text-pretty">
              PayPal gave AI agents the power to pay. Leash gives business owners the confidence to let them:
              a PayPal-backed budget, rules in plain English, one-tap approvals, and a firewall that stops
              hijacked agents before money moves.
            </p>
            <div className="flex flex-wrap gap-3">
              <ButtonLink href="/onboarding" size="lg">
                Try it with Bean There Café
              </ButtonLink>
              <ButtonLink href="/app" size="lg" variant="secondary">
                Open the control tower
              </ButtonLink>
              <ButtonLink href="/lab" size="lg" variant="ghost">
                Try to break it
              </ButtonLink>
            </div>
            <Suspense fallback={<Skeleton className="h-7 w-80" />}>
              <IntegrationStatus />
            </Suspense>
          </div>

          <Card className="shadow-raised">
            <CardHeader>
              <CardTitle>Bean There Café · Ops agent</CardTitle>
              <CardDescription>Weekly restock, live</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              <LeashMeter held={500} spent={200} pending={141} level={1} />
              <Timeline>
                <TimelineItem
                  icon={<BadgeCheck />}
                  tone="allow"
                  title="Northside Roasters · 2× espresso beans"
                  meta="$84.00"
                >
                  <VerdictBadge verdict="ALLOW" /> 6% below market price
                </TimelineItem>
                <TimelineItem
                  icon={<Gauge />}
                  tone="review"
                  title="Oat & Co · oat milk, 4 cases"
                  meta="$141.00"
                >
                  <VerdictBadge verdict="NEEDS_APPROVAL" /> Over your $120 limit, sent to your phone
                </TimelineItem>
                <TimelineItem
                  icon={<ShieldCheck />}
                  tone="block"
                  title="5× $100 gift cards"
                  meta="$500.00"
                  last
                >
                  <VerdictBadge verdict="BLOCK" /> Hidden instruction found in a supplier listing
                </TimelineItem>
              </Timeline>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4 sm:grid-cols-3">
          {principles.map(({ icon: Icon, title, body }) => (
            <Card key={title}>
              <CardHeader>
                <Icon className="text-primary mb-2 size-5" aria-hidden />
                <CardTitle>{title}</CardTitle>
                <CardDescription>{body}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </section>
      </main>
    </div>
  );
}

async function IntegrationStatus() {
  await connection();
  const f: Features = publicFeatureSnapshot();
  const items: { label: string; live: boolean }[] = [
    { label: "PayPal sandbox", live: f.paypalLive },
    { label: "Claude", live: f.aiLive },
    { label: "Channel3", live: f.channel3Live },
    { label: "Postgres", live: f.postgres },
  ];
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Integration status">
      {items.map((i) => (
        <li key={i.label}>
          <Badge tone={i.live ? "allow" : "neutral"}>
            <span
              aria-hidden
              className={i.live ? "bg-allow size-1.5 rounded-full" : "bg-subtle size-1.5 rounded-full"}
            />
            {i.label}: {i.live ? "live" : "offline mode"}
          </Badge>
        </li>
      ))}
    </ul>
  );
}
