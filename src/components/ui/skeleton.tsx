import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div aria-hidden className={cn("bg-surface-muted animate-pulse rounded-md", className)} {...props} />
  );
}
