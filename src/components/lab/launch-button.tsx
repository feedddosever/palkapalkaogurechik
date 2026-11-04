"use client";

import { useActionState } from "react";
import { Play } from "lucide-react";
import { launchLabAction, type LabLaunchState } from "@/app/lab/actions";
import { Button } from "@/components/ui/button";

/** Runs one preset attack in a fresh sandbox. */
export function LaunchButton({
  scenario,
  label,
  variant = "primary",
  disabled = false,
}: {
  scenario: string;
  label: string;
  variant?: "primary" | "secondary";
  disabled?: boolean;
}) {
  const [state, action, pending] = useActionState<LabLaunchState, FormData>(launchLabAction, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="scenario" value={scenario} />
      <Button type="submit" variant={variant} disabled={disabled || pending} aria-busy={pending}>
        <Play aria-hidden /> {pending ? "Setting up a sandbox café…" : label}
      </Button>
      {state.error ? (
        <p role="alert" className="text-block text-sm">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
