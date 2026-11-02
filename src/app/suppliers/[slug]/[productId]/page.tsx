import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DEMO_SUPPLIERS, getDemoSupplier } from "@/server/catalog/demo-suppliers";

export function generateStaticParams() {
  return DEMO_SUPPLIERS.flatMap((s) => s.products.map((p) => ({ slug: s.slug, productId: p.id })));
}

export async function generateMetadata({
  params,
}: PageProps<"/suppliers/[slug]/[productId]">): Promise<Metadata> {
  const { slug, productId } = await params;
  const product = getDemoSupplier(slug)?.products.find((p) => p.id === productId);
  return { title: product?.name ?? "Product" };
}

export default async function ProductPage({ params }: PageProps<"/suppliers/[slug]/[productId]">) {
  const { slug, productId } = await params;
  const supplier = getDemoSupplier(slug);
  const product = supplier?.products.find((p) => p.id === productId);
  if (!supplier || !product) notFound();

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
      <Link href={`/suppliers/${supplier.slug}`} className="text-sm text-neutral-500 hover:text-neutral-900">
        ← {supplier.name}
      </Link>
      <article className="mt-4 flex flex-col gap-4" data-product-id={product.id}>
        <h1 className="text-3xl font-semibold tracking-tight">{product.name}</h1>
        <p className="text-2xl font-semibold tabular-nums" style={{ color: supplier.accent }}>
          ${product.price} <span className="text-base font-normal text-neutral-500">per {product.unit}</span>
        </p>
        <p className="text-neutral-700">{product.description}</p>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 rounded-xl border border-neutral-200 p-5 text-sm">
          {Object.entries(product.attributes).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-neutral-500 capitalize">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <button
          type="button"
          disabled
          className="self-start rounded-lg px-5 py-2.5 text-sm font-medium text-white opacity-90"
          style={{ background: supplier.accent }}
        >
          Add to order
        </button>
        {product.hiddenText ? (
          // Invisible to people, but present in the page text any scraping agent reads.
          // This is the prompt injection the Leash guard has to catch.
          <p
            aria-hidden
            data-testid="hidden-listing-text"
            className="pointer-events-none absolute -z-10 size-px overflow-hidden text-[1px] leading-none text-white select-none"
          >
            {product.hiddenText}
          </p>
        ) : null}
      </article>
    </main>
  );
}
