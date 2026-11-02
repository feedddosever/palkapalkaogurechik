import { cn } from "@/lib/cn";

/** Leash mark: a handle loop and a lead that ends in a clasp. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-7", className)}>
      <rect width="32" height="32" rx="9" className="fill-primary" />
      <path
        d="M10.5 9.5a4 4 0 1 1 5.6 3.66L19.5 22"
        fill="none"
        className="stroke-primary-foreground"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <circle cx="20.6" cy="23.4" r="2.6" className="fill-primary-foreground" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <LogoMark />
      <span className="text-lg">Leash</span>
    </span>
  );
}
