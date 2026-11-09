import { connection } from "next/server";
import { KeyRound, Wallet } from "lucide-react";
import { judgeInfo } from "@/server/judge";

/** Tells a judge how the PayPal approval step will work in this deployment. */
export async function JudgeHint() {
  await connection();
  const info = judgeInfo();
  if (!info.paypalLive) {
    return (
      <p className="border-border bg-surface-muted text-muted flex items-start gap-2 rounded-lg border p-3 text-sm">
        <Wallet className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          This deployment runs on Leash&apos;s PayPal simulator (no PayPal keys configured), so approving the
          hold takes one click. With keys, the same step opens PayPal&apos;s sandbox checkout.
        </span>
      </p>
    );
  }
  return (
    <div
      role="note"
      aria-label="PayPal sandbox login"
      className="border-info/30 bg-info-soft flex items-start gap-2 rounded-lg border p-3 text-sm"
    >
      <KeyRound className="text-info mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="flex flex-col gap-1">
        <span>
          Approving the hold opens <strong>PayPal&apos;s sandbox</strong>. Log in as the test buyer
          {info.buyer ? ":" : " (any sandbox personal account)."}
        </span>
        {info.buyer ? (
          <span className="flex flex-wrap gap-x-4 gap-y-1">
            <span>
              Email{" "}
              <code className="bg-surface rounded px-1.5 py-0.5 font-mono text-xs select-all">
                {info.buyer.email}
              </code>
            </span>
            <span>
              Password{" "}
              <code className="bg-surface rounded px-1.5 py-0.5 font-mono text-xs select-all">
                {info.buyer.password}
              </code>
            </span>
          </span>
        ) : null}
        <span className="text-muted text-xs">Sandbox only: no real money moves.</span>
      </div>
    </div>
  );
}
