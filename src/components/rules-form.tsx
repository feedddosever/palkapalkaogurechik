"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CircleHelp, Info, Sparkles, Wallet } from "lucide-react";
import { compileRulesAction, saveRulesAction, type CompileState } from "@/app/actions";
import { RuleCard } from "@/components/rule-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

function SubmitButton({
  children,
  variant = "primary",
}: {
  children: React.ReactNode;
  variant?: "primary" | "secondary";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending} aria-busy={pending}>
      {pending ? "Working…" : children}
    </Button>
  );
}

/**
 * Plain-English rules → compiled Rule Card → save. `mode="onboarding"` saves and opens the PayPal
 * hold; `mode="edit"` just saves a new rules version.
 */
export function RulesForm({ defaultText, mode }: { defaultText: string; mode: "onboarding" | "edit" }) {
  const [state, compile, compiling] = useActionState<CompileState, FormData>(compileRulesAction, {
    status: "idle",
  });

  return (
    <div className="flex flex-col gap-6">
      <form action={compile} className="flex flex-col gap-3">
        <label htmlFor="ownerText" className="text-sm font-medium">
          Tell your agent the rules, in your own words
        </label>
        <textarea
          id="ownerText"
          name="ownerText"
          defaultValue={state.status === "ok" ? state.ownerText : defaultText}
          rows={6}
          required
          minLength={15}
          maxLength={2000}
          className="border-border bg-surface shadow-card focus:ring-ring w-full rounded-xl border p-4 text-base leading-relaxed focus:ring-2 focus:outline-none"
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            variant={state.status === "ok" ? "secondary" : "primary"}
            disabled={compiling}
            aria-busy={compiling}
          >
            <Sparkles aria-hidden />{" "}
            {compiling ? "Compiling your rules…" : state.status === "ok" ? "Recompile" : "Compile my rules"}
          </Button>
          <span className="text-muted text-xs">
            Leash turns your words into rules it can enforce. You review them before anything is saved.
          </span>
        </div>
        {state.status === "error" ? (
          <p role="alert" className="text-block text-sm">
            {state.message}
          </p>
        ) : null}
      </form>

      {state.status === "ok" ? (
        <section
          aria-label="Compiled rules"
          className="border-border bg-surface shadow-card flex flex-col gap-5 rounded-xl border p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-semibold">Here&apos;s what Leash will enforce</h3>
            <Badge tone={state.source === "ai" ? "primary" : "neutral"}>
              {state.source === "ai" ? "Compiled by Claude" : "Offline compiler"}
            </Badge>
          </div>
          <RuleCard card={state.ruleCard} />

          {state.changes && (mode === "edit" || state.changes.length > 0) ? (
            <div className="bg-surface-muted rounded-lg p-3 text-sm">
              <p className="font-medium">Changes from your current rules</p>
              {state.changes.length ? (
                <ul className="text-muted mt-1 list-disc pl-5">
                  {state.changes.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted">No changes.</p>
              )}
            </div>
          ) : null}

          {state.assumptions.length ? (
            <div className="text-muted flex gap-2 text-sm">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              <div>
                <p className="text-foreground font-medium">Assumptions</p>
                <ul className="list-disc pl-5">
                  {state.assumptions.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
          {state.clarifications.length ? (
            <div className="text-review flex gap-2 text-sm">
              <CircleHelp className="mt-0.5 size-4 shrink-0" aria-hidden />
              <div>
                <p className="font-medium">Worth clarifying (edit your text and recompile)</p>
                <ul className="list-disc pl-5">
                  {state.clarifications.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}

          <form
            action={saveRulesAction}
            className="border-border flex flex-wrap items-center gap-3 border-t pt-4"
          >
            <input type="hidden" name="draftId" value={state.draftId} />
            <input type="hidden" name="next" value={mode === "onboarding" ? "fund" : "save"} />
            {mode === "onboarding" ? (
              <SubmitButton>
                <Wallet aria-hidden /> Looks right: fund the leash with PayPal
              </SubmitButton>
            ) : (
              <SubmitButton>Save these rules</SubmitButton>
            )}
            <span className="text-muted text-xs">
              {mode === "onboarding"
                ? "Next, you approve a weekly hold in PayPal. You're only charged for what your agent spends."
                : "The guard uses the new rules from the next payment request."}
            </span>
          </form>
        </section>
      ) : null}
    </div>
  );
}
