"use client";

import { useState, useCallback } from "react";
import { Mic, Users, MessageSquare, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { VoicePicker, type VoiceAssignment } from "./voice-picker";
import { GenerationProgress } from "./generation-progress";
import type { EpisodeStyle, EpisodeTone } from "@/types/episode";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STYLES: {
  value: EpisodeStyle;
  label: string;
  description: string;
  icon: React.ElementType;
}[] = [
  {
    value: "monologue",
    label: "Monologue",
    description: "Single narrator explores the topic",
    icon: Mic,
  },
  {
    value: "interview",
    label: "Interview",
    description: "Host interviews a subject-matter expert",
    icon: MessageSquare,
  },
  {
    value: "group_chat",
    label: "Group Chat",
    description: "Multiple voices discuss the topic",
    icon: Users,
  },
];

const TONES: { value: EpisodeTone; label: string }[] = [
  { value: "serious", label: "Serious" },
  { value: "lighthearted", label: "Lighthearted" },
  { value: "dark_mystery", label: "Dark Mystery" },
  { value: "business_news", label: "Business News" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface EpisodeConfigProps {
  /** Pre-filled topic from chat or manual entry */
  initialTopic?: string;
  /** Render prop for the trigger element */
  trigger?: React.ReactNode;
  /** Controlled open state (optional) */
  open?: boolean;
  /** Callback when open state changes */
  onOpenChange?: (open: boolean) => void;
}

export function EpisodeConfig({
  initialTopic = "",
  trigger,
  open: controlledOpen,
  onOpenChange,
}: EpisodeConfigProps) {
  // Form state
  const [topic, setTopic] = useState(initialTopic);
  const [lengthMinutes, setLengthMinutes] = useState(5);
  const [style, setStyle] = useState<EpisodeStyle>("monologue");
  const [tone, setTone] = useState<EpisodeTone>("serious");
  const [voiceAssignments, setVoiceAssignments] = useState<VoiceAssignment[]>(
    []
  );

  // Generation state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [generatingEpisodeId, setGeneratingEpisodeId] = useState<
    string | null
  >(null);

  // Keep topic in sync when initialTopic changes
  const [lastInitialTopic, setLastInitialTopic] = useState(initialTopic);
  if (initialTopic !== lastInitialTopic) {
    setLastInitialTopic(initialTopic);
    setTopic(initialTopic);
  }

  const isGenerating = generatingEpisodeId !== null;
  const isFormValid =
    topic.trim().length > 0 &&
    voiceAssignments.length > 0 &&
    voiceAssignments.every((a) => a.voice_id);

  const handleGenerate = useCallback(async () => {
    if (!isFormValid || isSubmitting) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      // Step 1: Create episode
      const createRes = await fetch("/api/episodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topicQuery: topic.trim(),
          style,
          tone,
          lengthMinutes,
          voiceConfig: {
            voices: voiceAssignments.map((a) => ({
              role: a.role,
              voice_id: a.voice_id,
              name: a.name,
            })),
          },
        }),
      });

      if (!createRes.ok) {
        const data = await createRes.json().catch(() => null);
        throw new Error(data?.error ?? "Failed to create episode");
      }

      const { episode } = await createRes.json();

      // Step 2: Start pipeline
      const genRes = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ episodeId: episode.id }),
      });

      if (!genRes.ok) {
        const data = await genRes.json().catch(() => null);
        throw new Error(data?.error ?? "Failed to start generation");
      }

      // Switch to progress view
      setGeneratingEpisodeId(episode.id);
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "An unexpected error occurred"
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [isFormValid, isSubmitting, topic, style, tone, lengthMinutes, voiceAssignments]);

  const handleReset = useCallback(() => {
    setGeneratingEpisodeId(null);
    setSubmitError(null);
    setTopic(initialTopic);
    setLengthMinutes(5);
    setStyle("monologue");
    setTone("serious");
    setVoiceAssignments([]);
  }, [initialTopic]);

  const handleProgressClose = useCallback(() => {
    handleReset();
    onOpenChange?.(false);
  }, [handleReset, onOpenChange]);

  const dialogContent = isGenerating ? (
    <>
      <DialogHeader>
        <DialogTitle>Generating Episode</DialogTitle>
        <DialogDescription>
          Your podcast episode is being generated. This may take a few minutes.
        </DialogDescription>
      </DialogHeader>
      <GenerationProgress
        episodeId={generatingEpisodeId}
        onClose={handleProgressClose}
      />
    </>
  ) : (
    <>
      <DialogHeader>
        <DialogTitle>Configure Episode</DialogTitle>
        <DialogDescription>
          Set up your podcast episode parameters and choose voices.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-5 max-h-[60vh] overflow-y-auto pr-1">
        {/* Topic */}
        <div className="space-y-2">
          <Label htmlFor="episode-topic">Topic</Label>
          <Input
            id="episode-topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="What should this episode be about?"
          />
        </div>

        {/* Length slider */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Length</Label>
            <span className="text-sm text-muted-foreground tabular-nums">
              {lengthMinutes} min
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">1</span>
            <Slider
              value={[lengthMinutes]}
              onValueChange={(val) => {
                const v = Array.isArray(val) ? val[0] : val;
                setLengthMinutes(v);
              }}
              min={1}
              max={30}
              step={1}
            />
            <span className="text-xs text-muted-foreground">30</span>
          </div>
        </div>

        {/* Style selector */}
        <div className="space-y-2">
          <Label>Style</Label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {STYLES.map(({ value, label, description, icon: Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => setStyle(value)}
                className={`flex flex-col items-start gap-1.5 rounded-lg border p-3 text-left text-sm transition-colors ${
                  style === value
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border hover:bg-muted"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Icon className="size-4" />
                  <span className="font-medium">{label}</span>
                </div>
                <span
                  className={`text-xs ${
                    style === value
                      ? "text-primary/70"
                      : "text-muted-foreground"
                  }`}
                >
                  {description}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Tone selector */}
        <div className="space-y-2">
          <Label>Tone</Label>
          <div className="flex flex-wrap gap-2">
            {TONES.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setTone(value)}
                className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                  tone === value
                    ? "border-primary bg-primary/5 text-primary font-medium"
                    : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Voice picker */}
        <VoicePicker
          style={style}
          value={voiceAssignments}
          onChange={setVoiceAssignments}
        />
      </div>

      {/* Error */}
      {submitError && (
        <p className="text-sm text-destructive">{submitError}</p>
      )}

      <DialogFooter>
        <Button
          onClick={handleGenerate}
          disabled={!isFormValid || isSubmitting}
          className="w-full sm:w-auto"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Creating...
            </>
          ) : (
            "Generate Episode"
          )}
        </Button>
      </DialogFooter>
    </>
  );

  return (
    <Dialog open={controlledOpen} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger render={<>{trigger}</>} />}
      <DialogContent className="sm:max-w-lg">
        {dialogContent}
      </DialogContent>
    </Dialog>
  );
}
