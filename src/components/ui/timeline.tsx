import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

const dotTones = {
  neutral: "bg-surface-muted text-muted ring-border",
  primary: "bg-accent text-accent-foreground ring-transparent",
  allow: "bg-allow-soft text-allow ring-transparent",
  review: "bg-review-soft text-review ring-transparent",
  block: "bg-block-soft text-block ring-transparent",
  info: "bg-info-soft text-info ring-transparent",
} as const;

export type TimelineTone = keyof typeof dotTones;

export function Timeline({ className, ...props }: ComponentProps<"ol">) {
  return <ol className={cn("relative flex flex-col", className)} {...props} />;
}

export function TimelineItem({
  icon,
  tone = "neutral",
  title,
  meta,
  children,
  last = false,
}: {
  icon: ReactNode;
  tone?: TimelineTone;
  title: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
  last?: boolean;
}) {
  return (
    <li className="relative flex gap-3 pb-5 last:pb-0">
      {!last ? <span aria-hidden className="bg-border absolute top-8 bottom-0 left-4 w-px" /> : null}
      <span
        className={cn(
          "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full ring-1 [&_svg]:size-4",
          dotTones[tone],
        )}
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1 pt-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <span className="text-sm font-medium">{title}</span>
          {meta ? <span className="tabular text-subtle text-xs">{meta}</span> : null}
        </div>
        {children ? <div className="text-muted text-sm">{children}</div> : null}
      </div>
    </li>
  );
}
