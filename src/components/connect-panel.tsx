"use client";

import { useActionState, useState } from "react";
import { KeyRound, TriangleAlert } from "lucide-react";
import { createApiKeyAction, type ApiKeyState } from "@/app/actions";
import { CopyBlock } from "@/components/copy-block";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

const PLACEHOLDER = "leash_sk_YOUR_KEY";

type Tab = "claude-code" | "claude-desktop" | "stdio" | "toolkit";

const TABS: { id: Tab; label: string }[] = [
  { id: "claude-code", label: "Claude Code" },
  { id: "claude-desktop", label: "Claude Desktop" },
  { id: "stdio", label: "Any stdio client" },
  { id: "toolkit", label: "PayPal Agent Toolkit" },
];

function snippet(tab: Tab, base: string, key: string) {
  const endpoint = `${base}/api/mcp`;
  switch (tab) {
    case "claude-code":
      return `claude mcp add --transport http leash ${endpoint} \\\n  --header "Authorization: Bearer ${key}"`;
    case "claude-desktop":
      return JSON.stringify(
        {
          mcpServers: {
            leash: {
              command: "npx",
              args: ["-y", "mcp-remote@0.15.0", endpoint, "--header", "Authorization:${AUTH_HEADER}"],
              env: { AUTH_HEADER: `Bearer ${key}` },
            },
          },
        },
        null,
        2,
      );
    case "stdio":
      return `# from a clone of the Leash repo\nLEASH_URL=${base} LEASH_API_KEY=${key} npm run mcp:stdio`;
    case "toolkit":
      return [
        `import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";`,
        `import { withLeash } from "./with-leash"; // src/sdk/with-leash.ts from the Leash repo`,
        ``,
        `const toolkit = new PayPalAgentToolkit({`,
        `  clientId: process.env.PAYPAL_CLIENT_ID!,`,
        `  clientSecret: process.env.PAYPAL_CLIENT_SECRET!,`,
        `  configuration: {`,
        `    actions: { payments: { createRefund: true }, disputes: { create: true } },`,
        `    context: { sandbox: true },`,
        `  },`,
        `});`,
        ``,
        `// create_refund and accept_dispute_claim now ask Leash first.`,
        `const tools = withLeash(toolkit.getTools(), {`,
        `  url: "${base}",`,
        `  apiKey: process.env.LEASH_API_KEY!, // ${key === PLACEHOLDER ? "your key" : "the key you just created"}`,
        `  context: () => ({ sources: [{ kind: "email", text: customerEmail }] }),`,
        `});`,
      ].join("\n");
  }
}

/** Create a key, then copy a ready-made config for the agent you use. */
export function ConnectPanel({ base }: { base: string }) {
  const [state, action, pending] = useActionState<ApiKeyState, FormData>(createApiKeyAction, {});
  const [tab, setTab] = useState<Tab>("claude-code");
  const key = state.key ?? PLACEHOLDER;

  return (
    <div className="flex flex-col gap-6">
      <form action={action} className="flex flex-col gap-2">
        <label htmlFor="key-name" className="text-sm font-medium">
          1. Create a key for your agent
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="key-name"
            name="name"
            required
            minLength={2}
            maxLength={60}
            placeholder="e.g. Claude Desktop on Dana's laptop"
            className="border-border bg-surface focus:ring-ring h-10 w-full rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
          />
          <Button type="submit" disabled={pending} aria-busy={pending} className="shrink-0">
            <KeyRound aria-hidden /> {pending ? "Creating…" : "Create key"}
          </Button>
        </div>
        {state.error ? (
          <p role="alert" className="text-block text-sm">
            {state.error}
          </p>
        ) : null}
        {state.key ? (
          <div
            role="status"
            aria-label="New API key"
            className="border-review/40 bg-review-soft flex flex-col gap-2 rounded-lg border p-3"
          >
            <p className="text-review flex items-center gap-1.5 text-sm font-medium">
              <TriangleAlert className="size-4" aria-hidden /> Copy this key now. Leash only keeps a hash of
              it.
            </p>
            <CopyBlock code={state.key} label="API key" className="bg-surface" />
          </div>
        ) : null}
      </form>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">2. Add Leash to your agent</p>
        <div role="tablist" aria-label="Agent" className="-mx-1 flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm whitespace-nowrap transition-colors",
                tab === t.id
                  ? "bg-surface text-foreground shadow-card ring-border font-medium ring-1"
                  : "text-muted hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div role="tabpanel" aria-label={TABS.find((t) => t.id === tab)?.label}>
          <CopyBlock
            code={snippet(tab, base, key)}
            label={`${TABS.find((t) => t.id === tab)?.label} config`}
          />
          <p className="text-muted mt-2 text-xs">
            {tab === "claude-code"
              ? "Then ask Claude to restock the café. Every payment it asks for shows up in your agent console."
              : tab === "claude-desktop"
                ? "Paste into claude_desktop_config.json and restart Claude Desktop."
                : tab === "stdio"
                  ? "A small bridge: stdio on one side, this Leash's MCP endpoint on the other."
                  : "Refunds and dispute acceptances ask Leash first: small clean refunds run, big or suspicious ones wait for you or are blocked, and nothing is refunded twice."}
          </p>
        </div>
      </div>
    </div>
  );
}
