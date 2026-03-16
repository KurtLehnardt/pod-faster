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
    }
    onOpenChange(nextOpen);
  }

  const loading = addLoading || importLoading;
  const error = addError || importError;

  async function handleAddUrl() {
    if (!feedUrl.trim()) return;
    try {
      const data = await addFeed(feedUrl.trim());
      setResult(`Added "${data.feed?.title || feedUrl}" with ${data.episodesImported ?? 0} episodes`);
      setFeedUrl("");
      onSuccess();
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
    } catch {
      // error is set by hook
    }
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setOpmlContent(reader.result);
        setUploadedFileName(file.name);
      }
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
