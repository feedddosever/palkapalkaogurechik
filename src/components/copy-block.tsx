"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/cn";

/** A code snippet with a copy button. */
export function CopyBlock({ code, label, className }: { code: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={cn("border-border bg-surface-muted relative rounded-lg border", className)}>
      <pre className="overflow-x-auto p-3 pr-12 font-mono text-xs leading-relaxed whitespace-pre">
        <code>{code}</code>
      </pre>
      <button
        type="button"
        aria-label={copied ? `${label} copied` : `Copy ${label}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* clipboard unavailable: the text is selectable */
          }
        }}
        className="text-muted hover:text-foreground hover:bg-surface focus-visible:ring-ring absolute top-2 right-2 rounded-md p-1.5 focus-visible:ring-2 focus-visible:outline-none"
      >
        {copied ? (
          <Check className="text-allow size-4" aria-hidden />
        ) : (
          <Copy className="size-4" aria-hidden />
        )}
      </button>
    </div>
  );
}
