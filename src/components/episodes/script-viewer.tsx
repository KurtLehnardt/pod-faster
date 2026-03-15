"use client";

import { useEffect, useRef } from "react";
import { useAudioPlayer } from "@/lib/hooks/use-audio-player";
import type { EpisodeScript, ScriptSegment } from "@/types/episode";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Speaker color palette (deterministic by index)
// ---------------------------------------------------------------------------

const SPEAKER_COLORS = [
  { bg: "bg-blue-500/10", border: "border-blue-500/30", text: "text-blue-400", avatar: "bg-blue-500/20 text-blue-400" },
  { bg: "bg-emerald-500/10", border: "border-emerald-500/30", text: "text-emerald-400", avatar: "bg-emerald-500/20 text-emerald-400" },
  { bg: "bg-amber-500/10", border: "border-amber-500/30", text: "text-amber-400", avatar: "bg-amber-500/20 text-amber-400" },
  { bg: "bg-purple-500/10", border: "border-purple-500/30", text: "text-purple-400", avatar: "bg-purple-500/20 text-purple-400" },
  { bg: "bg-rose-500/10", border: "border-rose-500/30", text: "text-rose-400", avatar: "bg-rose-500/20 text-rose-400" },
  { bg: "bg-cyan-500/10", border: "border-cyan-500/30", text: "text-cyan-400", avatar: "bg-cyan-500/20 text-cyan-400" },
] as const;

function getSpeakerColor(speakerIndex: number) {
  return SPEAKER_COLORS[speakerIndex % SPEAKER_COLORS.length];
}

function getSpeakerInitials(speaker: string): string {
  return speaker
    .split(/[\s_-]+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

// ---------------------------------------------------------------------------
// Estimate which segment is active based on playback position.
// Without per-segment timestamps we distribute time evenly by text length.
// ---------------------------------------------------------------------------

function estimateActiveSegment(
  segments: ScriptSegment[],
  currentTime: number,
  duration: number
): number {
  if (segments.length === 0 || duration <= 0 || currentTime <= 0) return -1;

  const totalChars = segments.reduce((sum, s) => sum + s.text.length, 0);
  if (totalChars === 0) return -1;

  let accumulated = 0;
  for (let i = 0; i < segments.length; i++) {
    accumulated += segments[i].text.length;
    const segEnd = (accumulated / totalChars) * duration;
    if (currentTime < segEnd) return i;
  }
  return segments.length - 1;
}

// ---------------------------------------------------------------------------
// SegmentBubble
// ---------------------------------------------------------------------------

function SegmentBubble({
  segment,
  speakerIndex,
  isActive,
  innerRef,
}: {
  segment: ScriptSegment;
  speakerIndex: number;
  isActive: boolean;
  innerRef?: React.Ref<HTMLDivElement>;
}) {
  const color = getSpeakerColor(speakerIndex);

  return (
    <div
      ref={innerRef}
      className={cn(
        "flex gap-3 rounded-lg border p-3 transition-all duration-300",
        color.bg,
        color.border,
        isActive && "ring-2 ring-primary/40 shadow-md"
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold",
          color.avatar
        )}
      >
        {getSpeakerInitials(segment.speaker)}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <p className={cn("mb-1 text-xs font-semibold", color.text)}>
          {segment.speaker}
        </p>
        <p className="text-sm leading-relaxed text-foreground/90">
          {segment.text}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ScriptViewer
// ---------------------------------------------------------------------------

interface ScriptViewerProps {
  script: EpisodeScript;
  /** The episode ID currently loaded in the player (enables highlight sync). */
  episodeId?: string;
  className?: string;
}

export function ScriptViewer({ script, episodeId, className }: ScriptViewerProps) {
  const { currentEpisode, currentTime, duration } = useAudioPlayer();
  const activeRef = useRef<HTMLDivElement>(null);

  // Build speaker -> index map for consistent coloring
  const speakerMap = new Map<string, number>();
  let nextIdx = 0;
  for (const seg of script.segments) {
    if (!speakerMap.has(seg.speaker)) {
      speakerMap.set(seg.speaker, nextIdx++);
    }
  }

  // Determine which segment should be highlighted
  const isPlaying = currentEpisode?.id === episodeId;
  const activeIndex = isPlaying
    ? estimateActiveSegment(script.segments, currentTime, duration)
    : -1;

  // Auto-scroll to active segment
  useEffect(() => {
    if (activeIndex >= 0 && activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [activeIndex]);

  if (script.segments.length === 0) {
    return (
      <div className={cn("rounded-lg border border-border p-6 text-center", className)}>
        <p className="text-sm text-muted-foreground">No script segments available.</p>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {script.segments.map((segment, i) => (
        <SegmentBubble
          key={i}
          segment={segment}
          speakerIndex={speakerMap.get(segment.speaker) ?? 0}
          isActive={i === activeIndex}
          innerRef={i === activeIndex ? activeRef : undefined}
        />
      ))}
    </div>
  );
}
