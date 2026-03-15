"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Play, Square, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Voice, VoiceRole } from "@/types/voice";
import type { EpisodeStyle } from "@/types/episode";

/** Maps style to the voice roles needed. */
const STYLE_ROLES: Record<EpisodeStyle, { role: VoiceRole; label: string }[]> = {
  monologue: [{ role: "narrator", label: "Narrator" }],
  interview: [
    { role: "host", label: "Host" },
    { role: "expert", label: "Expert" },
  ],
  group_chat: [
    { role: "host", label: "Host" },
    { role: "expert", label: "Expert" },
    { role: "guest", label: "Guest" },
  ],
};

export interface VoiceAssignment {
  role: VoiceRole;
  voice_id: string;
  name: string;
}

interface VoicePickerProps {
  style: EpisodeStyle;
  value: VoiceAssignment[];
  onChange: (assignments: VoiceAssignment[]) => void;
}

export function VoicePicker({ style, value, onChange }: VoicePickerProps) {
  const [voices, setVoices] = useState<Voice[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Fetch voices on mount
  useEffect(() => {
    let cancelled = false;
    setLoadingVoices(true);
    setVoiceError(null);

    fetch("/api/voices")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load voices");
        return res.json();
      })
      .then((data) => {
        if (!cancelled) {
          setVoices(data.voices ?? []);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setVoiceError(err instanceof Error ? err.message : "Failed to load voices");
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingVoices(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Get required roles for current style
  const roles = STYLE_ROLES[style];

  // When style changes, reset assignments for roles that no longer apply
  useEffect(() => {
    const requiredRoles = new Set(roles.map((r) => r.role));
    const filtered = value.filter((a) => requiredRoles.has(a.role));

    // Ensure every required role has an entry (even if voice_id is empty)
    const existing = new Set(filtered.map((a) => a.role));
    const newAssignments = [...filtered];
    for (const r of roles) {
      if (!existing.has(r.role)) {
        newAssignments.push({ role: r.role, voice_id: "", name: "" });
      }
    }

    // Only update if there's a meaningful difference
    if (
      newAssignments.length !== value.length ||
      newAssignments.some(
        (a, i) => a.role !== value[i]?.role || a.voice_id !== value[i]?.voice_id
      )
    ) {
      onChange(newAssignments);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [style, roles.length]);

  const handleVoiceChange = useCallback(
    (role: VoiceRole, voiceId: string) => {
      const voice = voices.find((v) => v.voice_id === voiceId);
      const updated = value.map((a) =>
        a.role === role
          ? { ...a, voice_id: voiceId, name: voice?.name ?? "" }
          : a
      );

      // If the role isn't in the list yet, add it
      if (!updated.some((a) => a.role === role)) {
        updated.push({ role, voice_id: voiceId, name: voice?.name ?? "" });
      }

      onChange(updated);
    },
    [voices, value, onChange]
  );

  const togglePreview = useCallback(
    (previewUrl: string) => {
      if (playingUrl === previewUrl) {
        // Stop
        audioRef.current?.pause();
        setPlayingUrl(null);
        return;
      }

      // Stop current audio
      audioRef.current?.pause();

      const audio = new Audio(previewUrl);
      audioRef.current = audio;
      setPlayingUrl(previewUrl);

      audio.play().catch(() => {
        setPlayingUrl(null);
      });

      audio.onended = () => {
        setPlayingUrl(null);
      };
    },
    [playingUrl]
  );

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  if (loadingVoices) {
    return (
      <div className="space-y-2">
        <Label>Voices</Label>
        <p className="text-sm text-muted-foreground">Loading voices...</p>
      </div>
    );
  }

  if (voiceError) {
    return (
      <div className="space-y-2">
        <Label>Voices</Label>
        <p className="text-sm text-destructive">{voiceError}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Label>Voices</Label>
      {roles.map(({ role, label }) => {
        const assignment = value.find((a) => a.role === role);
        const selectedVoice = voices.find(
          (v) => v.voice_id === assignment?.voice_id
        );

        return (
          <div key={role} className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground w-16 shrink-0">
              {label}
            </span>
            <Select
              value={assignment?.voice_id ?? null}
              onValueChange={(val) => {
                if (val) handleVoiceChange(role, val);
              }}
            >
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Select a voice" />
              </SelectTrigger>
              <SelectContent>
                {voices.map((voice) => (
                  <SelectItem key={voice.voice_id} value={voice.voice_id}>
                    <Volume2 className="size-3.5 text-muted-foreground" />
                    {voice.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedVoice?.preview_url && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => togglePreview(selectedVoice.preview_url!)}
                aria-label={
                  playingUrl === selectedVoice.preview_url
                    ? "Stop preview"
                    : "Play preview"
                }
              >
                {playingUrl === selectedVoice.preview_url ? (
                  <Square className="size-3.5" />
                ) : (
                  <Play className="size-3.5" />
                )}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export { STYLE_ROLES };
