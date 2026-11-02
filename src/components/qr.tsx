import QRCode from "qrcode";
import { cn } from "@/lib/cn";

/** Server-rendered QR code (SVG) for opening a link on a phone. */
export async function Qr({ url, label, className }: { url: string; label: string; className?: string }) {
  const svg = await QRCode.toString(url, {
    type: "svg",
    margin: 0,
    color: { dark: "#16181d", light: "#ffffff" },
  });
  return (
    <div
      role="img"
      aria-label={label}
      className={cn("ring-border size-24 rounded-lg bg-white p-1.5 ring-1 [&_svg]:size-full", className)}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
