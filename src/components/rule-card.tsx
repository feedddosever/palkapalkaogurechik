import { Ban, Check, Hand } from "lucide-react";
import type { RuleCard as RuleCardData } from "@/server/guard/rule-card";
import { cn } from "@/lib/cn";

const columns = [
  { key: "auto", title: "Your agent can", Icon: Check, tone: "text-allow bg-allow-soft" },
  { key: "ask", title: "Asks you first", Icon: Hand, tone: "text-review bg-review-soft" },
  { key: "never", title: "Never", Icon: Ban, tone: "text-block bg-block-soft" },
] as const;

/** The owner-facing view of the compiled policy. Rendered from the policy itself, never from AI prose. */
export function RuleCard({
  card,
  compact = false,
  className,
}: {
  card: RuleCardData;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-4", compact ? "sm:grid-cols-3" : "md:grid-cols-3", className)}>
      {columns.map(({ key, title, Icon, tone }) => (
        <section key={key} aria-label={title} className="flex flex-col gap-2">
          <h4 className="flex items-center gap-2 text-sm font-semibold">
            <span
              className={cn("flex size-6 items-center justify-center rounded-full [&_svg]:size-3.5", tone)}
            >
              <Icon aria-hidden />
            </span>
            {title}
          </h4>
          <ul className="text-muted flex flex-col gap-1.5 text-sm">
            {(compact ? card[key].slice(0, 4) : card[key]).map((line) => (
              <li key={line} className="leading-snug">
                {line}
              </li>
            ))}
            {compact && card[key].length > 4 ? (
              <li className="text-subtle">+{card[key].length - 4} more</li>
            ) : null}
          </ul>
        </section>
      ))}
    </div>
  );
}
