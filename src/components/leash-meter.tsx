import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format";

export type AutonomyLevel = 0 | 1 | 2 | 3 | 4;

export const LEVEL_NAMES: Record<AutonomyLevel, string> = {
  0: "Ask",
  1: "Assisted",
  2: "Budgeted",
  3: "Trusted",
  4: "Autopilot",
};

/**
 * The signature Leash visual: the PayPal hold as a bar (spent / pending approval / remaining)
 * plus the agent's autonomy level drawn as leash length.
 */
export function LeashMeter({
  held,
  spent,
  pending = 0,
  level,
  className,
}: {
  held: number;
  spent: number;
  pending?: number;
  level: AutonomyLevel;
  className?: string;
}) {
  const safeHeld = Math.max(held, 0.01);
  const spentPct = Math.min(100, (spent / safeHeld) * 100);
  const pendingPct = Math.min(100 - spentPct, (pending / safeHeld) * 100);
  const remaining = Math.max(0, held - spent - pending);

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-subtle text-xs font-medium tracking-wide uppercase">PayPal hold</span>
          <span className="tabular text-muted text-sm">
            <span className="text-foreground font-semibold">{formatMoney(remaining)}</span> left of{" "}
            {formatMoney(held)}
          </span>
        </div>
        <div
          className="bg-surface-muted flex h-3 w-full overflow-hidden rounded-full"
          role="img"
          aria-label={`${formatMoney(spent)} spent, ${formatMoney(pending)} awaiting approval, ${formatMoney(remaining)} remaining of ${formatMoney(held)}`}
        >
          <div
            className="bg-primary h-full transition-[width] duration-500"
            style={{ width: `${spentPct}%` }}
          />
          <div
            className="bg-review/70 h-full transition-[width] duration-500"
            style={{ width: `${pendingPct}%` }}
          />
        </div>
        <div className="text-muted flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <Legend className="bg-primary" label={`Spent ${formatMoney(spent)}`} />
          {pending > 0 ? (
            <Legend className="bg-review/70" label={`Awaiting you ${formatMoney(pending)}`} />
          ) : null}
          <Legend className="bg-surface-muted ring-border ring-1" label={`Released at week end`} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-subtle text-xs font-medium tracking-wide uppercase">Leash length</span>
          <span className="text-muted text-sm">
            <span className="text-foreground font-semibold">L{level}</span> · {LEVEL_NAMES[level]}
          </span>
        </div>
        <ol className="grid grid-cols-5 gap-1.5" aria-label={`Autonomy level ${level} of 4`}>
          {([0, 1, 2, 3, 4] as const).map((l) => (
            <li
              key={l}
              className={cn(
                "h-2 rounded-full transition-colors",
                l <= level ? "bg-primary" : "bg-surface-muted ring-border ring-1",
              )}
            />
          ))}
        </ol>
      </div>
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className={cn("size-2 rounded-full", className)} />
      {label}
    </span>
  );
}
