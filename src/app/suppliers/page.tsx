import Link from "next/link";
import type { Metadata } from "next";
import { BadgeCheck, CircleAlert } from "lucide-react";
import { DEMO_SUPPLIERS } from "@/server/catalog/demo-suppliers";

export const metadata: Metadata = { title: "Demo suppliers" };

export default function SuppliersIndex() {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Demo supplier directory</h1>
      <p className="mt-2 text-sm text-neutral-600">
        The storefronts Bean There Café&apos;s ops agent shops from. One of them is not what it seems.
      </p>
      <ul className="mt-8 grid gap-4 sm:grid-cols-2">
        {DEMO_SUPPLIERS.map((s) => (
          <li key={s.slug}>
            <Link
              href={`/suppliers/${s.slug}`}
              className="flex h-full flex-col gap-2 rounded-xl border border-neutral-200 p-5 transition-colors hover:border-neutral-400"
            >
              <span className="flex items-center gap-2">
                <span aria-hidden className="size-3 rounded-full" style={{ background: s.accent }} />
                <span className="font-medium">{s.name}</span>
              </span>
              <span className="text-sm text-neutral-600">{s.tagline}</span>
              <span className="mt-auto inline-flex items-center gap-1 text-xs text-neutral-500">
                {s.verified ? (
                  <>
                    <BadgeCheck className="size-3.5 text-emerald-700" aria-hidden /> Verified business
                  </>
                ) : (
                  <>
                    <CircleAlert className="size-3.5 text-amber-700" aria-hidden /> Unverified seller
                  </>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
