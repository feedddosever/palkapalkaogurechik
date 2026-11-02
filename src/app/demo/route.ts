import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { WORKSPACE_COOKIE } from "@/server/views";
import { provisionWorkspace } from "@/server/workspace";

/**
 * Judge mode: every visit creates a fresh, isolated Bean There Café and binds it to this browser,
 * so anyone can run the full story without stepping on anyone else.
 */
export async function GET() {
  const { workspaceId } = await provisionWorkspace("demo");
  (await cookies()).set(WORKSPACE_COOKIE, workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
    secure: process.env.NODE_ENV === "production" && !process.env.APP_URL?.startsWith("http://"),
  });
  redirect("/onboarding");
}
