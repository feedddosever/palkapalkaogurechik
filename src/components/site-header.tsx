import Link from "next/link";
import { Logo } from "@/components/logo";

const link =
  "text-muted hover:text-foreground rounded-lg px-3 py-1.5 text-sm whitespace-nowrap transition-colors";

/** Header for public pages (landing, Attack Lab). */
export function SiteHeader() {
  return (
    <header className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-5 sm:px-6">
      <Link href="/" aria-label="Leash home">
        <Logo />
      </Link>
      <nav aria-label="Site" className="-mx-1 flex items-center gap-1">
        <Link href="/lab" className={link}>
          Attack Lab
        </Link>
        <Link href="/suppliers" className={link}>
          Suppliers
        </Link>
        <Link href="/app" className={link}>
          Open the app
        </Link>
      </nav>
    </header>
  );
}
