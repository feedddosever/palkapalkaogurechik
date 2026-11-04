import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BadgeCheck, CircleAlert, MapPin } from "lucide-react";
import { DEMO_SUPPLIERS, getDemoSupplier } from "@/server/catalog/demo-suppliers";

export function generateStaticParams() {
  return DEMO_SUPPLIERS.map((s) => ({ slug: s.slug }));
}

export async function generateMetadata({ params }: PageProps<"/suppliers/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  return { title: getDemoSupplier(slug)?.name ?? "Supplier" };
}

export default async function SupplierStore({ params }: PageProps<"/suppliers/[slug]">) {
  const { slug } = await params;
  const supplier = getDemoSupplier(slug);
  if (!supplier) notFound();

  return (
    <main className="flex-1">
      <header style={{ background: supplier.accent }} className="text-white">
        <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-10 sm:px-6">
          <Link href="/suppliers" className="text-xs text-white/75 hover:text-white">
            ← All suppliers
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight">{supplier.name}</h1>
          <p className="text-white/85">{supplier.tagline}</p>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/80">
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-4" aria-hidden /> {supplier.location}
            </span>
            <span className="inline-flex items-center gap-1">
              {supplier.verified ? (
                <BadgeCheck className="size-4" aria-hidden />
              ) : (
                <CircleAlert className="size-4" aria-hidden />
              )}
              {supplier.verified ? "Verified business" : "Unverified seller"}
            </span>
          </p>
        </div>
      </header>
      <section className="mx-auto grid max-w-5xl gap-4 px-4 py-8 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
        {supplier.products.map((p) => (
          <Link
            key={p.id}
            href={`/suppliers/${supplier.slug}/${p.id}`}
            className="flex flex-col gap-2 rounded-xl border border-neutral-200 p-5 transition-colors hover:border-neutral-400"
          >
            <span className="font-medium">{p.name}</span>
            <span className="text-sm text-neutral-600">{p.description}</span>
            <span className="mt-auto pt-2 text-lg font-semibold tabular-nums">
              ${p.price} <span className="text-sm font-normal text-neutral-500">/ {p.unit}</span>
            </span>
          </Link>
        ))}
      </section>
    </main>
  );
}
