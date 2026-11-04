"use client";

import { useRouter } from "next/navigation";
import { RunTimeline } from "@/components/run-timeline";

/** The lab run's live timeline; refreshes the page when the run ends so the verdict appears. */
export function LabRunLive({
  labRunId,
  runId,
  initiallyDone,
}: {
  labRunId: string;
  runId: string;
  initiallyDone: boolean;
}) {
  const router = useRouter();
  return (
    <RunTimeline
      runId={runId}
      eventsUrl={`/api/lab/runs/${encodeURIComponent(labRunId)}/events`}
      lab
      initiallyDone={initiallyDone}
      onDone={initiallyDone ? undefined : () => router.refresh()}
    />
  );
}
