"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { cn } from "@/lib/utils/index";
import type { Voice } from "@/types/voice";
import { Play, Square, Volume2 } from "lucide-react";

interface VoicePickerProps {
  value: string | null;
  onChange: (voiceId: string) => void;
}

export function VoicePicker({ value, onChange }: VoicePickerProps) {
  const [voices, setVoices] = useState<Voice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchVoices() {
      try {
        const res = await fetch("/api/voices");
        if (!res.ok) throw new Error("Failed to load voices");
        const data = await res.json();
        if (!cancelled) {
          setVoices(data.voices ?? []);
        }
      } catch {
        if (!cancelled) setError("Could not load voices");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchVoices();
    return () => {
      cancelled = true;
    };
  }, []);

  const stopPlayback = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    setPlayingId(null);
  }, []);

  const handlePreview = useCallback(
    (voice: Voice) => {
      if (playingId === voice.voice_id) {
        stopPlayback();
        return;
      }
      stopPlayback();
      if (!voice.preview_url) return;

      const audio = new Audio(voice.preview_url);
      audioRef.current = audio;
      setPlayingId(voice.voice_id);
      audio.play().catch(() => setPlayingId(null));
      audio.addEventListener("ended", () => setPlayingId(null));
    },
    [playingId, stopPlayback]
  );

  useEffect(() => {
    return () => stopPlayback();
  }, [stopPlayback]);

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-20 animate-pulse rounded-lg bg-muted"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-muted-foreground">{error}</p>
    );
  }

  if (voices.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No voices available.</p>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {voices.map((voice) => {
        const selected = value === voice.voice_id;
        const playing = playingId === voice.voice_id;
        return (
          <button
            key={voice.voice_id}
            type="button"
            onClick={() => onChange(voice.voice_id)}
            className={cn(
              "relative flex flex-col items-start gap-1 rounded-lg border p-3 text-left text-sm transition-colors",
              selected
                ? "border-primary bg-primary/5 ring-1 ring-primary"
                : "border-border hover:border-ring hover:bg-muted/50"
            )}
          >
            <div className="flex w-full items-center justify-between">
              <span className="font-medium truncate">{voice.name}</span>
              {voice.preview_url && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    handlePreview(voice);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      handlePreview(voice);
                    }
                  }}
                  className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label={playing ? "Stop preview" : "Play preview"}
                >
                  {playing ? (
                    <Square className="size-3.5" />
                  ) : (
                    <Play className="size-3.5" />
                  )}
                </span>
              )}
            </div>
            <span className="text-xs text-muted-foreground truncate w-full">
              {voice.category}
            </span>
            {selected && (
              <Volume2 className="absolute right-2 bottom-2 size-3.5 text-primary" />
            )}
          </button>
        );
      })}
    </div>
  );
}
