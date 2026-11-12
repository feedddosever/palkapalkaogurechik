import { ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { Badge } from "./badge";

export type Verdict = "ALLOW" | "NEEDS_APPROVAL" | "BLOCK";

const config = {
  ALLOW: { tone: "allow", label: "Allowed", Icon: ShieldCheck },
  NEEDS_APPROVAL: { tone: "review", label: "Needs approval", Icon: ShieldQuestion },
  BLOCK: { tone: "block", label: "Blocked", Icon: ShieldAlert },
} as const;

export function VerdictBadge({ verdict, className }: { verdict: Verdict; className?: string }) {
  const { tone, label, Icon } = config[verdict];
  return (
    <Badge tone={tone} className={className}>
      <Icon aria-hidden />
      {label}
    </Badge>
  );
}
