"use client";

import { useState, useCallback, useEffect } from "react";
import { Mic, Users, MessageSquare, Loader2, Rss, Check, Tag, X } from "lucide-react";
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
import { useFeeds } from "@/lib/hooks/use-feeds";
import { createClient } from "@/lib/supabase/client";
import type { EpisodeStyle, EpisodeTone } from "@/types/episode";

interface TopicItem {
  id: string;
  name: string;
}

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

type SourceMode = "topic" | "feeds" | "topics";

export function EpisodeConfig({
  initialTopic = "",
  trigger,
  open: controlledOpen,
  onOpenChange,
}: EpisodeConfigProps) {
  // Source mode state
  const [sourceMode, setSourceMode] = useState<SourceMode>("topic");

  // Form state
  const [topic, setTopic] = useState(initialTopic);
  const [lengthMinutes, setLengthMinutes] = useState(5);
  const [style, setStyle] = useState<EpisodeStyle>("monologue");
  const [tone, setTone] = useState<EpisodeTone>("serious");
  const [voiceAssignments, setVoiceAssignments] = useState<VoiceAssignment[]>(
    []
  );

  // Feed selection state (BUG-004 + BUG-008)
  const [selectedFeedIds, setSelectedFeedIds] = useState<Set<string>>(
    new Set()
  );
  const { feeds } = useFeeds();
  const activeFeeds = feeds.filter((f) => f.is_active);

  // Topic selection state (BUG-012 + BUG-013)
  const [availableTopics, setAvailableTopics] = useState<TopicItem[]>([]);
  const [includedTopicIds, setIncludedTopicIds] = useState<Set<string>>(
    new Set()
  );
  const [excludedTopicIds, setExcludedTopicIds] = useState<Set<string>>(
    new Set()
  );

  // Fetch topics when dialog opens in topics mode
  useEffect(() => {
    if (controlledOpen && sourceMode === "topics" && availableTopics.length === 0) {
      const supabase = createClient();
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (!user) return;
        supabase
          .from("topics")
          .select("id, name")
          .eq("user_id", user.id)
          .eq("is_active", true)
          .order("name")
          .then(({ data }) => {
            if (data) setAvailableTopics(data as TopicItem[]);
          });
      });
    }
  }, [controlledOpen, sourceMode, availableTopics.length]);

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

  function toggleFeed(feedId: string) {
    setSelectedFeedIds((prev) => {
      const next = new Set(prev);
      if (next.has(feedId)) {
        next.delete(feedId);
      } else {
        next.add(feedId);
      }
      return next;
    });
  }

  function toggleIncludeTopic(topicId: string) {
    setIncludedTopicIds((prev) => {
      const next = new Set(prev);
      if (next.has(topicId)) {
        next.delete(topicId);
      } else {
        next.add(topicId);
        // Remove from excluded if it was there
        setExcludedTopicIds((ex) => {
          const n = new Set(ex);
          n.delete(topicId);
          return n;
        });
      }
      return next;
    });
  }

  function toggleExcludeTopic(topicId: string) {
    setExcludedTopicIds((prev) => {
      const next = new Set(prev);
      if (next.has(topicId)) {
        next.delete(topicId);
      } else {
        next.add(topicId);
        // Remove from included if it was there
        setIncludedTopicIds((inc) => {
          const n = new Set(inc);
          n.delete(topicId);
          return n;
        });
      }
      return next;
    });
  }

  const isGenerating = generatingEpisodeId !== null;

  const hasVoices =
    voiceAssignments.length > 0 &&
    voiceAssignments.every((a) => a.voice_id);

  const isFormValid =
    sourceMode === "topic"
      ? topic.trim().length > 0 && hasVoices
      : sourceMode === "feeds"
        ? selectedFeedIds.size > 0 && hasVoices
        : includedTopicIds.size > 0 && hasVoices;

  const handleGenerate = useCallback(async () => {
    if (!isFormValid || isSubmitting) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      // Build the topic query based on source mode
      let effectiveTopic: string;
      if (sourceMode === "feeds") {
        const selectedTitles = activeFeeds
          .filter((f) => selectedFeedIds.has(f.id))
          .map((f) => f.title || f.feed_url);
        effectiveTopic =
          selectedTitles.length > 0
            ? `Summary of: ${selectedTitles.join(", ")}`
            : "Summary of my latest podcast feeds";
      } else if (sourceMode === "topics") {
        const selectedNames = availableTopics
          .filter((t) => includedTopicIds.has(t.id))
          .map((t) => t.name);
        effectiveTopic = selectedNames.join(", ");
      } else {
        effectiveTopic = topic.trim();
      }

      const excludedNames =
        sourceMode === "topics"
          ? availableTopics
              .filter((t) => excludedTopicIds.has(t.id))
              .map((t) => t.name)
          : [];

      // Step 1: Create episode
      const createRes = await fetch("/api/episodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topicQuery: effectiveTopic,
          sourceType: sourceMode === "feeds" ? "feed_summary" : "topic",
          feedIds:
            sourceMode === "feeds"
              ? Array.from(selectedFeedIds)
              : undefined,
          excludeTopics:
            excludedNames.length > 0 ? excludedNames : undefined,
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
  }, [isFormValid, isSubmitting, sourceMode, topic, selectedFeedIds, activeFeeds, availableTopics, includedTopicIds, excludedTopicIds, style, tone, lengthMinutes, voiceAssignments]);

  const handleReset = useCallback(() => {
    setGeneratingEpisodeId(null);
    setSubmitError(null);
    setSourceMode("topic");
    setTopic(initialTopic);
    setSelectedFeedIds(new Set());
    setIncludedTopicIds(new Set());
    setExcludedTopicIds(new Set());
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
        {/* Source mode tabs */}
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          <button
            type="button"
            onClick={() => setSourceMode("topic")}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              sourceMode === "topic"
                ? "bg-background shadow-sm"
                : "text-muted-foreground"
            }`}
          >
            Custom Topic
          </button>
          <button
            type="button"
            onClick={() => setSourceMode("feeds")}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              sourceMode === "feeds"
                ? "bg-background shadow-sm"
                : "text-muted-foreground"
            }`}
          >
            From Feeds
          </button>
          <button
            type="button"
            onClick={() => setSourceMode("topics")}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              sourceMode === "topics"
                ? "bg-background shadow-sm"
                : "text-muted-foreground"
            }`}
          >
            From Topics
          </button>
        </div>

        {/* Topic input, feed selector, or topic selector */}
        {sourceMode === "topic" ? (
          <div className="space-y-2">
            <Label htmlFor="episode-topic">Topic</Label>
            <Input
              id="episode-topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="What should this episode be about?"
            />
          </div>
        ) : sourceMode === "feeds" ? (
          <div className="space-y-2">
            <Label>Select Feeds</Label>
            <p className="text-xs text-muted-foreground">
              Generate an episode summarizing your latest feed content.
            </p>
            {activeFeeds.length === 0 ? (
              <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                No active feeds. Import feeds first.
              </p>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {selectedFeedIds.size} of {activeFeeds.length} feeds selected
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedFeedIds.size === activeFeeds.length) {
                        setSelectedFeedIds(new Set());
                      } else {
                        setSelectedFeedIds(new Set(activeFeeds.map((f) => f.id)));
                      }
                    }}
                    className="text-xs text-primary hover:underline"
                  >
                    {selectedFeedIds.size === activeFeeds.length
                      ? "Deselect All"
                      : "Select All"}
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {activeFeeds.map((feed) => {
                    const selected = selectedFeedIds.has(feed.id);
                    return (
                      <button
                        key={feed.id}
                        type="button"
                        onClick={() => toggleFeed(feed.id)}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                          selected
                            ? "border-primary bg-primary/10 text-primary font-medium"
                            : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                        }`}
                      >
                        {selected && <Check className="size-3" />}
                        <Rss className="size-3" />
                        {feed.title || feed.feed_url}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {/* Include topics */}
            <div className="space-y-2">
              <Label>Include Topics</Label>
              <p className="text-xs text-muted-foreground">
                Select topics to base the episode on.
              </p>
              {availableTopics.length === 0 ? (
                <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                  No topics available. Add topics on the Topics page first.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {availableTopics.map((t) => {
                    const included = includedTopicIds.has(t.id);
                    const excluded = excludedTopicIds.has(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => toggleIncludeTopic(t.id)}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                          included
                            ? "border-primary bg-primary/10 text-primary font-medium"
                            : excluded
                              ? "border-border opacity-40 line-through"
                              : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                        }`}
                      >
                        {included && <Check className="size-3" />}
                        <Tag className="size-3" />
                        {t.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Exclude topics */}
            {availableTopics.length > 0 && (
              <div className="space-y-2">
                <Label>Exclude Topics</Label>
                <p className="text-xs text-muted-foreground">
                  Select topics to exclude from episode generation.
                </p>
                <div className="flex flex-wrap gap-2">
                  {availableTopics
                    .filter((t) => !includedTopicIds.has(t.id))
                    .map((t) => {
                      const excluded = excludedTopicIds.has(t.id);
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => toggleExcludeTopic(t.id)}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                            excluded
                              ? "border-destructive bg-destructive/10 text-destructive font-medium"
                              : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                          }`}
                        >
                          {excluded && <X className="size-3" />}
                          <Tag className="size-3" />
                          {t.name}
                        </button>
                      );
                    })}
                </div>
              </div>
            )}
          </div>
        )}

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
