import Link from "next/link";
import { Info } from "lucide-react";

/** Chrome for the demo supplier sites: clearly labelled as part of the Leash demo. */
export default function SuppliersLayout({ children }: LayoutProps<"/suppliers">) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-white text-neutral-900">
      <div className="flex items-center justify-center gap-2 bg-neutral-900 px-4 py-2 text-center text-xs text-neutral-200">
        <Info className="size-3.5 shrink-0" aria-hidden />
        <span>
          Demo supplier site used by the{" "}
          <Link href="/" className="underline underline-offset-2">
            Leash
          </Link>{" "}
          demo. Not a real store.
        </span>
      </div>
      {children}
    </div>
  );
}
