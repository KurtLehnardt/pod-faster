"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useAddFeed, useImportOpml } from "@/lib/hooks/use-feeds";
import { createClient } from "@/lib/supabase/client";

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

type Mode = "url" | "opml";

export function ImportDialog({ open, onOpenChange, onSuccess }: ImportDialogProps) {
  const [mode, setMode] = useState<Mode>("url");
  const [feedUrl, setFeedUrl] = useState("");
  const [opmlContent, setOpmlContent] = useState("");
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const { addFeed, loading: addLoading, error: addError } = useAddFeed();
  const { importOpml, loading: importLoading, error: importError } = useImportOpml();

  // Reset all state when dialog closes (BUG-002)
  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setMode("url");
      setFeedUrl("");
      setOpmlContent("");
      setUploadedFileName(null);
      setResult(null);
      setFileError(null);
    }
    onOpenChange(nextOpen);
  }

  const loading = addLoading || importLoading;
  const error = addError || importError;

  /**
   * Extract meaningful keywords from a feed title by stripping common
   * noise words like articles, "Podcast", "Show", "Radio", etc.
   * Falls back to the description if the cleaned title is too short.
   */
  function extractTopicName(title: string, description?: string | null): string {
    const STRIP_WORDS = new Set([
      "the", "a", "an", "podcast", "show", "radio", "daily", "weekly",
      "with", "and", "of", "for", "in", "on", "by", "to",
    ]);

    const words = title
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 0);

    const meaningful = words.filter(
      (w) => !STRIP_WORDS.has(w.toLowerCase())
    );

    // If stripping left us with meaningful words, use them
    if (meaningful.length > 0) {
      return meaningful.join(" ");
    }

    // If the title was mostly noise (e.g. "The Daily"), try the description
    if (description) {
      const descWords = description
        .replace(/<[^>]+>/g, " ")
        .replace(/[^\w\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2 && !STRIP_WORDS.has(w.toLowerCase()))
        .slice(0, 5);
      if (descWords.length > 0) {
        return descWords.join(" ");
      }
    }

    // Last resort: use the original title
    return title;
  }

  /**
   * After feeds are added/imported, auto-generate topics from feed titles.
   * Creates one topic per feed, extracting keywords from titles. (BUG-010)
   */
  async function generateTopicsFromFeeds() {
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Get all feeds for the user (include description for fallback)
      const { data: feeds } = await supabase
        .from("podcast_feeds")
        .select("title, description")
        .eq("user_id", user.id)
        .not("title", "is", null);

      if (!feeds || feeds.length === 0) return;

      // Get existing topics to avoid duplicates
      const { data: existingTopics } = await supabase
        .from("topics")
        .select("name")
        .eq("user_id", user.id);

      const existingNames = new Set(
        (existingTopics ?? []).map((t) => (t.name as string).toLowerCase())
      );

      // Create topics from feed titles with keyword extraction
      const newTopics = feeds
        .filter((f) => f.title)
        .map((f) => {
          const topicName = extractTopicName(
            f.title as string,
            f.description as string | null
          );
          return { topicName, originalTitle: f.title as string };
        })
        .filter(({ topicName }) => !existingNames.has(topicName.toLowerCase()))
        .map(({ topicName, originalTitle }) => ({
          user_id: user.id,
          name: topicName,
          description: `Auto-generated from imported feed: ${originalTitle}`,
          is_active: true,
        }));

      if (newTopics.length > 0) {
        await supabase.from("topics").insert(newTopics);
      }
    } catch (err) {
      // Non-critical: log but don't fail the import
      console.error("[import] Topic generation failed:", err);
    }
  }

  async function handleAddUrl() {
    if (!feedUrl.trim()) return;
    try {
      const data = await addFeed(feedUrl.trim());
      setResult(`Added "${data.feed?.title || feedUrl}" with ${data.episodesImported ?? 0} episodes`);
      setFeedUrl("");
      onSuccess();
      // Auto-generate topics from the new feed
      generateTopicsFromFeeds();
    } catch {
      // error is set by hook
    }
  }

  async function handleImportOpml() {
    if (!opmlContent.trim()) return;
    try {
      const data = await importOpml(opmlContent.trim());
      setResult(`Created ${data.created} feeds, skipped ${data.skipped}`);
      setOpmlContent("");
      onSuccess();
      // Auto-generate topics from imported feeds
      generateTopicsFromFeeds();
    } catch {
      // error is set by hook
    }
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileError(null);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setOpmlContent(reader.result);
        setUploadedFileName(file.name);
      }
    };
    reader.onerror = () => {
      setUploadedFileName(null);
      setFileError("Failed to read the file. Please try again or paste the content manually.");
    };
    reader.readAsText(file);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import Podcast Feeds</DialogTitle>
        </DialogHeader>

        {/* Mode Tabs */}
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          <button
            onClick={() => { setMode("url"); setResult(null); }}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === "url" ? "bg-background shadow-sm" : "text-muted-foreground"
            }`}
          >
            RSS URL
          </button>
          <button
            onClick={() => { setMode("opml"); setResult(null); }}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === "opml" ? "bg-background shadow-sm" : "text-muted-foreground"
            }`}
          >
            OPML File
          </button>
        </div>

        {mode === "url" ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="feed-url">Feed URL</Label>
              <Input
                id="feed-url"
                placeholder="https://example.com/feed.xml"
                value={feedUrl}
                onChange={(e) => setFeedUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddUrl()}
              />
            </div>
            <Button onClick={handleAddUrl} disabled={loading || !feedUrl.trim()} className="w-full">
              {addLoading && <Loader2 className="mr-2 size-4 animate-spin" />}
              Add Feed
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Upload OPML</Label>
              <Input
                type="file"
                accept=".opml,.xml"
                onChange={handleFileUpload}
              />
              {uploadedFileName && (
                <p className="text-sm text-green-600">
                  Uploaded: {uploadedFileName}
                </p>
              )}
              {fileError && (
                <p className="text-sm text-destructive">{fileError}</p>
              )}
            </div>
            {!uploadedFileName && (
              <div className="space-y-1.5">
                <Label htmlFor="opml-content">Or paste OPML content</Label>
                <Textarea
                  id="opml-content"
                  placeholder="<?xml version='1.0'?>..."
                  value={opmlContent}
                  onChange={(e) => setOpmlContent(e.target.value)}
                  rows={6}
                />
              </div>
            )}
            <Button onClick={handleImportOpml} disabled={loading || !opmlContent.trim()} className="w-full">
              {importLoading && <Loader2 className="mr-2 size-4 animate-spin" />}
              Import Feeds
            </Button>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
        {result && <p className="text-sm text-green-600">{result}</p>}
      </DialogContent>
    </Dialog>
  );
}
