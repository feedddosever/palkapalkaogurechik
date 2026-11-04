import Link from "next/link";
import { Suspense } from "react";
import { AppNav } from "@/components/app-nav";
import { Logo } from "@/components/logo";

export default function AppLayout({ children }: LayoutProps<"/app">) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-border bg-background/85 sticky top-0 z-30 border-b backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <Link href="/" aria-label="Leash home" className="self-start sm:self-auto">
            <Logo />
          </Link>
          <Suspense fallback={<div className="h-8" aria-hidden />}>
            <AppNav />
          </Suspense>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
