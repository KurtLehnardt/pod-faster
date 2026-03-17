"use client";

import {
  CheckCircle2,
  Search,
  FileText,
  PenTool,
  Music,
  Upload,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Button, buttonVariants } from "@/components/ui/button";
import { useEpisodeStatus } from "@/lib/hooks/use-episode-status";
import type { EpisodeStatus } from "@/types/episode";

/** Ordered pipeline steps with their display info. */
const PIPELINE_STEPS: {
  status: EpisodeStatus;
  label: string;
  icon: React.ElementType;
}[] = [
  { status: "searching", label: "Searching", icon: Search },
  { status: "summarizing", label: "Summarizing", icon: FileText },
  { status: "scripting", label: "Writing Script", icon: PenTool },
  { status: "generating_audio", label: "Generating Audio", icon: Music },
  { status: "uploading", label: "Uploading", icon: Upload },
  { status: "completed", label: "Complete", icon: CheckCircle2 },
];

function getStepIndex(status: EpisodeStatus): number {
  const idx = PIPELINE_STEPS.findIndex((s) => s.status === status);
  return idx >= 0 ? idx : -1;
}

function getProgressPercent(status: EpisodeStatus): number {
  if (status === "pending") return 0;
  if (status === "failed") return 0;
  if (status === "completed") return 100;
  const idx = getStepIndex(status);
  if (idx < 0) return 0;
  // Each active step contributes a fraction; completed = 100
  return Math.round(((idx + 0.5) / (PIPELINE_STEPS.length - 1)) * 100);
}

interface GenerationProgressProps {
  episodeId: string | null;
  onClose?: () => void;
}

export function GenerationProgress({
  episodeId,
  onClose,
}: GenerationProgressProps) {
  const { episode, isLoading, error, isComplete, isFailed } =
    useEpisodeStatus(episodeId);

  if (!episodeId) return null;

  if (isLoading && !episode) {
    return (
      <div className="flex flex-col items-center gap-3 py-6">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading episode status...</p>
      </div>
    );
  }

  if (error && !episode) {
    return (
      <div className="flex flex-col items-center gap-3 py-6">
        <AlertCircle className="size-6 text-destructive" />
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (!episode) return null;

  const currentStatus = episode.status as EpisodeStatus;
  const progressPercent = getProgressPercent(currentStatus);
  const currentStepIdx = getStepIndex(currentStatus);

  return (
    <div className="space-y-4">
      {/* Progress bar */}
      <Progress value={progressPercent} />

      {/* Step indicators */}
      <div className="space-y-2">
        {PIPELINE_STEPS.map((step, idx) => {
          const Icon = step.icon;
          const isActive = step.status === currentStatus;
          const isDone = currentStepIdx > idx || isComplete;
          const isPending = currentStepIdx < idx && !isComplete;

          return (
            <div
              key={step.status}
              className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors ${
                isActive
                  ? "bg-primary/10 text-primary font-medium"
                  : isDone
                    ? "text-muted-foreground"
                    : isPending
                      ? "text-muted-foreground/40"
                      : ""
              }`}
            >
              {isDone && !isActive ? (
                <CheckCircle2 className="size-4 text-primary/60" />
              ) : isActive && isComplete ? (
                <CheckCircle2 className="size-4 text-primary" />
              ) : isActive ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Icon className="size-4" />
              )}
              <span>{step.label}</span>
            </div>
          );
        })}
      </div>

      {/* Error state */}
      {isFailed && (
        <div className="rounded-md border border-destructive/20 bg-destructive/5 p-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="size-4 text-destructive mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-destructive">
                Generation failed
              </p>
              {episode.error_message && (
                <p className="text-xs text-destructive/80">
                  {episode.error_message}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Complete state */}
      {isComplete && (
        <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-4 text-primary shrink-0" />
            <p className="text-sm font-medium text-primary">
              Episode generated successfully!
            </p>
          </div>
        </div>
      )}

      {/* Action buttons */}
      {(isComplete || isFailed) && onClose && (
        <div className="flex gap-2">
          {isComplete && (
            <a href="/episodes" className={buttonVariants({ variant: "default" }) + " flex-1"}>
              View Episode
            </a>
          )}
          <Button variant="outline" onClick={onClose} className={isComplete ? "flex-1" : "w-full"}>
            {isComplete ? "Create Another" : "Close"}
          </Button>
        </div>
      )}
    </div>
  );
}
