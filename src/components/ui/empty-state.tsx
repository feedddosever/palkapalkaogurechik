import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "border-border-strong flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center",
        className,
      )}
    >
      {icon ? <div className="text-subtle mb-1 [&_svg]:size-6">{icon}</div> : null}
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="text-muted max-w-sm text-sm">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
