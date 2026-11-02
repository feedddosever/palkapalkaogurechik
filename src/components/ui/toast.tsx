"use client";

import { CheckCircle2, Info, ShieldAlert, X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type ToastTone = "info" | "allow" | "block";
type ToastItem = { id: number; title: string; description?: string; tone: ToastTone };

const ToastContext = createContext<((t: Omit<ToastItem, "id">) => void) | null>(null);

const icons = { info: Info, allow: CheckCircle2, block: ShieldAlert } as const;
const tones = {
  info: "text-info",
  allow: "text-allow",
  block: "text-block",
} as const;

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);

  const push = useCallback(
    (t: Omit<ToastItem, "id">) => {
      const id = nextId++;
      setItems((xs) => [...xs.slice(-3), { ...t, id }]);
      setTimeout(() => dismiss(id), 6000);
    },
    [dismiss],
  );

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end"
      >
        {items.map((t) => {
          const Icon = icons[t.tone];
          return (
            <div
              key={t.id}
              role="status"
              className="border-border bg-surface shadow-raised pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border p-4"
            >
              <Icon className={cn("mt-0.5 size-5 shrink-0", tones[t.tone])} aria-hidden />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className="text-sm font-medium">{t.title}</p>
                {t.description ? <p className="text-muted text-sm">{t.description}</p> : null}
              </div>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => dismiss(t.id)}
                className="text-subtle hover:text-foreground rounded-md p-0.5"
              >
                <X className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
