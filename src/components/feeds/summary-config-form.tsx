"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import type { PodcastFeed, SummaryConfig, Cadence } from "@/types/feed";

interface SummaryConfigFormProps {
  feeds: PodcastFeed[];
  existingConfig?: SummaryConfig & { feedIds?: string[] };
  onSubmit: (data: SummaryConfigFormData) => void;
  onCancel: () => void;
  loading?: boolean;
}

export interface SummaryConfigFormData {
  name: string;
  cadence: Cadence;
  preferredTime: string;
  style: "monologue" | "interview" | "group_chat";
  tone: "serious" | "lighthearted" | "dark_mystery" | "business_news";
  lengthMinutes: number;
  feedIds: string[];
}

const CADENCE_OPTIONS: { value: Cadence; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "twice_weekly", label: "Twice Weekly" },
  { value: "weekly", label: "Weekly" },
  { value: "on_new_episodes", label: "On New Episodes" },
];

const STYLE_OPTIONS: { value: string; label: string }[] = [
  { value: "monologue", label: "Monologue" },
  { value: "interview", label: "Interview" },
  { value: "group_chat", label: "Group Chat" },
];

const TONE_OPTIONS: { value: string; label: string }[] = [
  { value: "serious", label: "Serious" },
  { value: "lighthearted", label: "Lighthearted" },
  { value: "dark_mystery", label: "Dark Mystery" },
  { value: "business_news", label: "Business News" },
];

export function SummaryConfigForm({
  feeds,
  existingConfig,
  onSubmit,
  onCancel,
  loading,
}: SummaryConfigFormProps) {
  const [name, setName] = useState(existingConfig?.name ?? "My Summary Podcast");
  const [cadence, setCadence] = useState<Cadence>(existingConfig?.cadence ?? "daily");
  const [preferredTime, setPreferredTime] = useState(existingConfig?.preferred_time ?? "08:00");
  const [style, setStyle] = useState(existingConfig?.style ?? "monologue");
  const [tone, setTone] = useState(existingConfig?.tone ?? "serious");
  const [lengthMinutes, setLengthMinutes] = useState(existingConfig?.length_minutes ?? 10);
  const [selectedFeedIds, setSelectedFeedIds] = useState<Set<string>>(
    new Set(existingConfig?.feedIds ?? [])
  );

  function toggleFeed(feedId: string) {
    setSelectedFeedIds((prev) => {
      const next = new Set(prev);
      if (next.has(feedId)) next.delete(feedId);
      else next.add(feedId);
      return next;
    });
  }

  function toggleAll() {
    if (selectedFeedIds.size === feeds.length) {
      setSelectedFeedIds(new Set());
    } else {
      setSelectedFeedIds(new Set(feeds.map((f) => f.id)));
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({
      name,
      cadence,
      preferredTime,
      style,
      tone,
      lengthMinutes,
      feedIds: Array.from(selectedFeedIds),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Name */}
      <div className="space-y-1.5">
        <Label htmlFor="config-name">Name</Label>
        <Input
          id="config-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Summary Podcast"
        />
      </div>

      {/* Cadence */}
      <div className="space-y-1.5">
        <Label>Cadence</Label>
        <div className="flex flex-wrap gap-2">
          {CADENCE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setCadence(opt.value)}
              className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                cadence === opt.value
                  ? "border-primary bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Preferred Time */}
      {cadence !== "on_new_episodes" && (
        <div className="space-y-1.5">
          <Label htmlFor="preferred-time">Preferred Time</Label>
          <Input
            id="preferred-time"
            type="time"
            value={preferredTime}
            onChange={(e) => setPreferredTime(e.target.value)}
          />
        </div>
      )}

      {/* Style */}
      <div className="space-y-1.5">
        <Label>Style</Label>
        <div className="flex flex-wrap gap-2">
          {STYLE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setStyle(opt.value as typeof style)}
              className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                style === opt.value
                  ? "border-primary bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tone */}
      <div className="space-y-1.5">
        <Label>Tone</Label>
        <div className="flex flex-wrap gap-2">
          {TONE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setTone(opt.value as typeof tone)}
              className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                tone === opt.value
                  ? "border-primary bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Length */}
      <div className="space-y-1.5">
        <Label>Length: {lengthMinutes} minutes</Label>
        <Slider
          value={[lengthMinutes]}
          onValueChange={(v) => setLengthMinutes(Array.isArray(v) ? v[0] : v)}
          min={1}
          max={60}
          step={1}
        />
      </div>

      {/* Feed Selection */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>Include Feeds ({selectedFeedIds.size}/{feeds.length})</Label>
          <button
            type="button"
            onClick={toggleAll}
            className="text-xs text-primary hover:underline"
          >
            {selectedFeedIds.size === feeds.length ? "Deselect All" : "Select All"}
          </button>
        </div>
        <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
          {feeds.length === 0 ? (
            <p className="py-2 text-center text-xs text-muted-foreground">
              No feeds available. Import feeds first.
            </p>
          ) : (
            feeds.map((feed) => (
              <label
                key={feed.id}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-accent"
              >
                <input
                  type="checkbox"
                  checked={selectedFeedIds.has(feed.id)}
                  onChange={() => toggleFeed(feed.id)}
                  className="size-4 rounded border-input"
                />
                <span className="truncate text-sm">{feed.title || feed.feed_url}</span>
              </label>
            ))
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={loading || selectedFeedIds.size === 0}>
          {loading && <Loader2 className="mr-2 size-4 animate-spin" />}
          {existingConfig ? "Update" : "Create"} Summary
        </Button>
      </div>
    </form>
  );
}
