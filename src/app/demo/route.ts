import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { clientKeyFor } from "@/server/lab/runner";
import { allowDemo } from "@/server/judge";
import { WORKSPACE_COOKIE } from "@/server/views";
import { provisionWorkspace } from "@/server/workspace";

/**
 * Judge mode: every visit creates a fresh, isolated Bean There Café and binds it to this browser,
 * so anyone can run the full story without stepping on anyone else.
 */
const NEXT: Record<string, string> = { onboarding: "/onboarding", app: "/app" };

export async function GET(req: Request) {
  // Always per request: never prerendered at build time (it creates a workspace).
  await connection();
  const next = NEXT[new URL(req.url).searchParams.get("to") ?? ""] ?? "/onboarding";
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip");
  if (!allowDemo(clientKeyFor(ip))) redirect("/demo/busy");

  const { workspaceId } = await provisionWorkspace("demo");
  (await cookies()).set(WORKSPACE_COOKIE, workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
    secure: process.env.NODE_ENV === "production" && !process.env.APP_URL?.startsWith("http://"),
  });
  redirect(next);
}
