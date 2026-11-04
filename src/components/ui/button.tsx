import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

const base =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-colors " +
  "disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0";

const variants = {
  primary: "bg-primary text-primary-foreground hover:bg-primary-hover shadow-card",
  secondary: "bg-surface text-foreground border border-border hover:bg-surface-muted shadow-card",
  ghost: "text-foreground hover:bg-surface-muted",
  danger: "bg-block text-white hover:opacity-90 shadow-card",
  allow: "bg-allow text-white hover:opacity-90 shadow-card",
} as const;

const sizes = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
  icon: "size-9",
} as const;

export type ButtonVariant = keyof typeof variants;
export type ButtonSize = keyof typeof sizes;

type Common = { variant?: ButtonVariant; size?: ButtonSize; className?: string };

export function buttonClasses({ variant = "primary", size = "md", className }: Common = {}) {
  return cn(base, variants[variant], sizes[size], className);
}

export function Button({
  variant,
  size,
  className,
  type = "button",
  ...props
}: Common & ComponentProps<"button">) {
  return <button type={type} className={buttonClasses({ variant, size, className })} {...props} />;
}

export function ButtonLink({ variant, size, className, ...props }: Common & ComponentProps<typeof Link>) {
  return <Link className={buttonClasses({ variant, size, className })} {...props} />;
}
