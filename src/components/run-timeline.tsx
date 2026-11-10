"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  Bot,
  CircleAlert,
  CircleCheck,
  FileSignature,
  Gauge,
  Inbox,
  Mail,
  Package,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Smartphone,
  Sparkles,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Timeline, TimelineItem, type TimelineTone } from "@/components/ui/timeline";
import { formatMoney } from "@/lib/format";
import { layerChip, orderLayers } from "@/lib/layers";

type AgentEvent = { id: number; type: string; payload: Record<string, unknown>; at: string };
type Layer = { layer: string; verdict: string; codes: string[]; reasons: string[] };

const TOOL_LABEL: Record<string, (i: Record<string, unknown>) => string> = {
  check_inventory: () => "Checked inventory against par levels",
  search_products: (i) => `Searched suppliers for "${String(i.query ?? "")}"`,
  read_product_page: (i) => `Read the product page for ${String(i.product_id ?? "")}`,
  read_inbox: () => "Read the supplier inbox",
  read_email: () => "Opened an email",
  get_budget: () => "Checked the remaining budget and rules",
  request_purchase: () => "Asked Leash to pay for a purchase",
  pay_invoice: () => "Asked Leash to pay an invoice",
  finish: () => "Wrote a summary for Dana",
};

const TOOL_ICON: Record<string, React.ReactNode> = {
  check_inventory: <Package />,
  search_products: <Search />,
  read_product_page: <Package />,
  read_inbox: <Inbox />,
  read_email: <Mail />,
  get_budget: <Wallet />,
  request_purchase: <Wallet />,
  pay_invoice: <Wallet />,
  finish: <Bot />,
};

const VERDICT: Record<string, { tone: TimelineTone; icon: React.ReactNode; label: string }> = {
  ALLOW: { tone: "allow", icon: <ShieldCheck />, label: "Allowed" },
  NEEDS_APPROVAL: { tone: "review", icon: <ShieldQuestion />, label: "Needs your approval" },
  BLOCK: { tone: "block", icon: <ShieldAlert />, label: "Blocked" },
};

export function RunTimeline({
  runId,
  initiallyDone = false,
  eventsUrl = `/api/runs/${encodeURIComponent(runId)}/events`,
  lab = false,
  onDone,
}: {
  runId: string;
  initiallyDone?: boolean;
  /** Where to stream events from (the Attack Lab uses its own public, sandbox-scoped stream). */
  eventsUrl?: string;
  /** Attack Lab: approvals go to a simulated owner, not to a page in someone's app. */
  lab?: boolean;
  onDone?: () => void;
}) {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [state, setState] = useState<"connecting" | "live" | "done" | "error">("connecting");
  const bottom = useRef<HTMLDivElement>(null);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  }, [onDone]);

  useEffect(() => {
    const source = new EventSource(eventsUrl);
    source.addEventListener("agent", (e) => {
      const ev = JSON.parse((e as MessageEvent).data) as AgentEvent;
      setState("live");
      setEvents((xs) => (xs.some((x) => x.id === ev.id) ? xs : [...xs, ev]));
    });
    source.addEventListener("end", () => {
      setState("done");
      source.close();
      done.current?.();
    });
    source.onerror = () => {
      setState((s) => (s === "done" ? s : "error"));
      source.close();
    };
    return () => source.close();
  }, [eventsUrl]);

  useEffect(() => {
    if (state === "live") bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [events.length, state]);

  const visible = events.filter((e) => e.type !== "tool_result");
  if (visible.length === 0) {
    return (
      <div className="flex flex-col gap-3" aria-busy>
        <p className="text-muted text-sm">{initiallyDone ? "Loading the run…" : "Starting the agent…"}</p>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-4/5" />
      </div>
    );
  }

  const lastEvent = visible[visible.length - 1];
  const status =
    lastEvent?.type === "run_finished"
      ? "finished"
      : lastEvent?.type === "run_failed"
        ? "failed"
        : state === "error"
          ? "disconnected"
          : "running";
  return (
    <div className="flex flex-col gap-4">
      <Badge
        tone={status === "finished" ? "allow" : status === "running" ? "primary" : "block"}
        className="self-start"
      >
        {status}
      </Badge>
      <div aria-live="polite" className="sr-only">
        {state === "done" ? "The agent run has completed." : `${visible.length} steps so far`}
      </div>
      <Timeline>
        {visible.map((e, idx) => (
          <EventItem key={e.id} event={e} last={idx === visible.length - 1} lab={lab} />
        ))}
      </Timeline>
      {state === "live" ? (
        <p className="text-muted flex items-center gap-2 text-sm">
          <span className="bg-primary size-2 animate-pulse rounded-full" aria-hidden /> Agent is working…
        </p>
      ) : null}
      {state === "error" ? (
        <p className="text-block text-sm">Lost the live connection. Refresh to continue.</p>
      ) : null}
      <div ref={bottom} />
    </div>
  );
}

function EventItem({ event, last, lab }: { event: AgentEvent; last: boolean; lab: boolean }) {
  const p = event.payload;
  const time = new Date(event.at).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });

  switch (event.type) {
    case "run_started":
      return (
        <TimelineItem icon={<Bot />} tone="primary" title="Run started" meta={time} last={last}>
          {String(p.task ?? "")}
          <div className="mt-1 flex flex-wrap gap-1.5">
            {p.mode === "compromised" ? (
              // A simulated attack is scripted on purpose, with or without Claude.
              <Badge tone="block">
                {p.persona === "fooled" ? "Simulated fooled agent" : "Simulated hijacked agent"}
              </Badge>
            ) : (
              <Badge tone="neutral">
                {p.driver === "claude"
                  ? "Claude agent"
                  : p.driver === "mcp"
                    ? `Outside agent over MCP${p.agent ? `: ${String(p.agent)}` : ""}`
                    : p.driver === "toolkit"
                      ? "PayPal Agent Toolkit (guarded)"
                      : "Scripted agent (offline)"}
              </Badge>
            )}
          </div>
        </TimelineItem>
      );
    case "thought":
      return (
        <TimelineItem icon={<Sparkles />} tone="neutral" title="Agent" meta={time} last={last}>
          <span className="whitespace-pre-line italic">{String(p.text ?? "")}</span>
        </TimelineItem>
      );
    case "tool_call": {
      const name = String(p.name ?? "");
      if (name === "request_purchase" || name === "pay_invoice") return null;
      const label = TOOL_LABEL[name]?.((p.input as Record<string, unknown>) ?? {}) ?? name;
      return (
        <TimelineItem
          icon={TOOL_ICON[name] ?? <Bot />}
          tone="neutral"
          title={label}
          meta={time}
          last={last}
        />
      );
    }
    case "guard_decision": {
      const v = VERDICT[String(p.verdict)] ?? VERDICT.NEEDS_APPROVAL;
      const layers = (p.layers as Layer[]) ?? [];
      const reasons = (p.reasons as string[]) ?? [];
      return (
        <TimelineItem
          icon={v.icon}
          tone={v.tone}
          title={
            <span>
              {v.label}: {formatMoney(String(p.amount))} to {String(p.supplier)}
            </span>
          }
          meta={time}
          last={last}
        >
          {p.verdict !== "ALLOW" && reasons.length ? (
            <ul className="text-foreground mt-1 flex list-disc flex-col gap-1 pl-4">
              {reasons.slice(0, 3).map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {orderLayers(layers).map((l) => {
              const chip = layerChip(l);
              return (
                <Badge key={l.layer} tone={chip.tone} title={l.reasons.join(" ") || l.codes.join(", ")}>
                  {chip.label}
                </Badge>
              );
            })}
            {typeof p.latencyMs === "number" ? <Badge tone="neutral">{p.latencyMs} ms</Badge> : null}
          </div>
        </TimelineItem>
      );
    }
    case "approval_requested":
      return (
        <TimelineItem
          icon={<Smartphone />}
          tone="review"
          title="Sent to Dana's phone"
          meta={time}
          last={last}
        >
          {lab ? (
            <span>
              {formatMoney(String(p.amount))} for {String(p.supplier)} waits for Dana. Nothing moves until she
              taps Approve.
            </span>
          ) : (
            <Link
              href={`/approve/${String(p.approvalId)}`}
              className="text-primary font-medium hover:underline"
            >
              Review {formatMoney(String(p.amount))} for {String(p.supplier)}
            </Link>
          )}
        </TimelineItem>
      );
    case "payment_executed":
      return (
        <TimelineItem
          icon={<CircleCheck />}
          tone="allow"
          title={`Paid ${formatMoney(String(p.amount))} to ${String(p.supplier)}`}
          meta={time}
          last={last}
        >
          Captured from the PayPal hold and paid out to the supplier.{" "}
          {p.receiptId ? (
            <Link
              href={`/verify/${String(p.receiptId)}`}
              className="text-primary inline-flex items-center gap-1 font-medium hover:underline"
            >
              <FileSignature className="size-3.5" aria-hidden /> Signed receipt
            </Link>
          ) : null}
        </TimelineItem>
      );
    case "payment_failed":
      return (
        <TimelineItem
          icon={<CircleAlert />}
          tone="block"
          title={`Payment failed: ${formatMoney(String(p.amount))}`}
          meta={time}
          last={last}
        >
          {String(p.error ?? "")}
        </TimelineItem>
      );
    case "trust_changed":
      return (
        <TimelineItem
          icon={<Gauge />}
          tone="block"
          title={`Leash shortened: L${String(p.from)} → L${String(p.to)}`}
          meta={time}
          last={last}
        >
          A blocked attack means more of the agent&apos;s requests now need your approval.
        </TimelineItem>
      );
    case "run_finished":
      return (
        <TimelineItem icon={<CircleCheck />} tone="primary" title="Run finished" meta={time} last={last}>
          {String(p.summary ?? "")}
        </TimelineItem>
      );
    case "run_failed":
      return (
        <TimelineItem icon={<CircleAlert />} tone="block" title="Run failed" meta={time} last={last}>
          {String(p.error ?? "")}
        </TimelineItem>
      );
    default:
      return null;
  }
}
