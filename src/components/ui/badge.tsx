import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

const tones = {
  neutral: "bg-surface-muted text-muted border-border",
  primary: "bg-accent text-accent-foreground border-transparent",
  allow: "bg-allow-soft text-allow border-transparent",
  review: "bg-review-soft text-review border-transparent",
  block: "bg-block-soft text-block border-transparent",
  info: "bg-info-soft text-info border-transparent",
} as const;

export type BadgeTone = keyof typeof tones;

export function Badge({
  tone = "neutral",
  className,
  ...props
}: { tone?: BadgeTone } & ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium [&_svg]:size-3.5",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
