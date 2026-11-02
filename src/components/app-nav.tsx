"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const LINKS = [
  { href: "/app", label: "Control tower" },
  { href: "/app/rules", label: "Rules" },
  { href: "/suppliers", label: "Suppliers" },
];

export function AppNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="-mx-1 flex gap-1 overflow-x-auto">
      {LINKS.map((l) => {
        const active =
          l.href === "/app"
            ? pathname === "/app" || pathname.startsWith("/app/runs")
            : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm whitespace-nowrap transition-colors",
              active
                ? "bg-surface text-foreground shadow-card ring-border font-medium ring-1"
                : "text-muted hover:text-foreground",
            )}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
