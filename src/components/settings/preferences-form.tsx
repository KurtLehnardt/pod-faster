"use client";

import { useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Database, PodcastStyle, PodcastTone } from "@/types/database.types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { VoicePicker } from "@/components/settings/voice-picker";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

interface PreferencesFormProps {
  profile: Profile;
}

const STYLE_OPTIONS: { value: PodcastStyle; label: string }[] = [
  { value: "monologue", label: "Monologue" },
  { value: "interview", label: "Interview" },
  { value: "group_chat", label: "Group Chat" },
];

const TONE_OPTIONS: { value: PodcastTone; label: string }[] = [
  { value: "serious", label: "Serious" },
  { value: "lighthearted", label: "Lighthearted" },
  { value: "dark_mystery", label: "Dark Mystery" },
  { value: "business_news", label: "Business News" },
];

export function PreferencesForm({ profile }: PreferencesFormProps) {
  const [displayName, setDisplayName] = useState(profile.display_name ?? "");
  const [defaultLength, setDefaultLength] = useState(profile.default_length);
  const [defaultStyle, setDefaultStyle] = useState<PodcastStyle>(
    profile.default_style
  );
  const [defaultTone, setDefaultTone] = useState<PodcastTone>(
    profile.default_tone
  );
  const [defaultVoiceId, setDefaultVoiceId] = useState<string | null>(
    profile.default_voice_id
  );
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("profiles")
        .update({
          display_name: displayName || null,
          default_length: defaultLength,
          default_style: defaultStyle,
          default_tone: defaultTone,
          default_voice_id: defaultVoiceId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", profile.id);

      if (error) throw error;
      toast.success("Preferences saved");
    } catch {
      toast.error("Failed to save preferences");
    } finally {
      setSaving(false);
    }
  }, [
    displayName,
    defaultLength,
    defaultStyle,
    defaultTone,
    defaultVoiceId,
    profile.id,
  ]);

  return (
    <div className="space-y-8">
      {/* Display Name */}
      <div className="space-y-2">
        <Label htmlFor="display-name">Display Name</Label>
        <Input
          id="display-name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Your name"
          className="max-w-sm"
        />
      </div>

      {/* Default Episode Length */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Default Episode Length</Label>
          <span className="text-sm font-medium tabular-nums text-muted-foreground">
            {defaultLength} min
          </span>
        </div>
        <Slider
          value={[defaultLength]}
          onValueChange={(val: number[]) => setDefaultLength(val[0])}
          min={1}
          max={30}
          step={1}
          className="max-w-sm"
        />
        <div className="flex justify-between text-xs text-muted-foreground max-w-sm">
          <span>1 min</span>
          <span>30 min</span>
        </div>
      </div>

      {/* Default Style */}
      <div className="space-y-2">
        <Label>Default Style</Label>
        <Select
          value={defaultStyle}
          onValueChange={(val) => setDefaultStyle(val as PodcastStyle)}
        >
          <SelectTrigger className="w-full max-w-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STYLE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Default Tone */}
      <div className="space-y-2">
        <Label>Default Tone</Label>
        <Select
          value={defaultTone}
          onValueChange={(val) => setDefaultTone(val as PodcastTone)}
        >
          <SelectTrigger className="w-full max-w-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TONE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Default Voice */}
      <div className="space-y-2">
        <Label>Default Voice</Label>
        <p className="text-xs text-muted-foreground">
          Select a default voice for new episodes. Click the play button to
          preview.
        </p>
        <VoicePicker value={defaultVoiceId} onChange={setDefaultVoiceId} />
      </div>

      {/* Save Button */}
      <Button onClick={handleSave} disabled={saving}>
        {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
        Save Preferences
      </Button>
    </div>
  );
}
