import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Stat({
  label,
  value,
  hint,
  tone = "default",
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "allow" | "review" | "block" | "primary";
  className?: string;
}) {
  const valueTone = {
    default: "text-foreground",
    allow: "text-allow",
    review: "text-review",
    block: "text-block",
    primary: "text-primary",
  }[tone];
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span className="text-subtle text-xs font-medium tracking-wide uppercase">{label}</span>
      <span className={cn("tabular text-2xl font-semibold tracking-tight", valueTone)}>{value}</span>
      {hint ? <span className="text-muted text-xs">{hint}</span> : null}
    </div>
  );
}
