"use client";

import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Accessible modal built on the native <dialog> element (focus trap, Esc, backdrop for free).
 * `side="right"` renders it as a sheet sliding in from the right.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  side = "center",
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  side?: "center" | "right";
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        "border-border bg-surface text-foreground shadow-raised m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl border p-0 backdrop:bg-black/40 backdrop:backdrop-blur-[2px]",
        side === "right" &&
          "mr-0 h-dvh max-h-dvh w-[min(36rem,100vw)] rounded-none rounded-l-xl border-y-0 border-r-0",
        className,
      )}
    >
      <div className="flex h-full flex-col">
        <header className="border-border flex items-start justify-between gap-4 border-b px-5 py-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold">{title}</h2>
            {description ? <p className="text-muted text-sm">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-muted hover:bg-surface-muted hover:text-foreground rounded-md p-1"
          >
            <X className="size-4" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <footer className="border-border flex justify-end gap-2 border-t px-5 py-3">{footer}</footer>
        ) : null}
      </div>
    </dialog>
  );
}
