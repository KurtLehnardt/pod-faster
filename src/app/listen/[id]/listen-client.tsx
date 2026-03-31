"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils/index";
import {
  ArrowRight,
  Check,
  Copy,
  Headphones,
  Share2,
} from "lucide-react";
import type { Json } from "@/types/database.types";

interface ScriptSegment {
  speaker: string;
  text: string;
}

interface Episode {
  id: string;
  title: string | null;
  topic_query: string;
  style: string;
  tone: string;
  status: string;
  audio_path: string | null;
  script: Json | null;
  created_at: string;
  audioUrl: string | null;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function getShareText(topic: string) {
  return `I just listened to an AI-generated podcast about ${topic} -- check it out!`;
}

function getSegments(script: Json | null): ScriptSegment[] {
  if (!script || typeof script !== "object") return [];
  const obj = script as Record<string, unknown>;
  if (Array.isArray(obj.segments)) {
    return obj.segments as ScriptSegment[];
  }
  return [];
}

export function ListenPageClient({ episode }: { episode: Episode }) {
  const [copied, setCopied] = useState(false);

  const title = episode.title || `Podcast about ${episode.topic_query}`;
  const shareText = getShareText(episode.topic_query);
  const shareUrl = typeof window !== "undefined" ? window.location.href : "";
  const segments = getSegments(episode.script);

  function handleCopyLink() {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function shareTwitter() {
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function shareLinkedIn() {
    const url = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function shareWhatsApp() {
    const url = `https://wa.me/?text=${encodeURIComponent(`${shareText} ${shareUrl}`)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <header className="border-b border-border px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <Link href="/" className="text-lg font-bold">
            pod-faster
          </Link>
          <Link
            href="/try"
            className={cn(buttonVariants({ size: "sm" }), "text-xs")}
          >
            Make Your Own
          </Link>
        </div>
      </header>

      {/* Main */}
      <main className="flex flex-1 flex-col items-center px-4 py-12 sm:py-16">
        <div className="w-full max-w-2xl">
          {/* Episode meta */}
          <div className="mb-6">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full border border-violet-500/30 bg-violet-600/10 px-2.5 py-0.5 text-xs font-medium text-violet-400">
                <Headphones className="size-3" />
                {episode.style}
              </span>
              <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground">
                {episode.tone}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatDate(episode.created_at)}
              </span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              {title}
            </h1>
            <p className="mt-1 text-muted-foreground">{episode.topic_query}</p>
          </div>

          {/* Audio player */}
          {episode.audioUrl && (
            <div className="mb-6 rounded-lg border border-violet-500/30 bg-violet-600/5 p-4">
              <audio controls src={episode.audioUrl} className="w-full" />
            </div>
          )}

          {/* Share buttons */}
          <div className="mb-8 flex flex-wrap items-center gap-2">
            <span className="mr-1 text-sm text-muted-foreground">
              <Share2 className="mb-0.5 inline-block size-3.5" /> Share:
            </span>
            <Button variant="outline" size="sm" onClick={shareTwitter}>
              X / Twitter
            </Button>
            <Button variant="outline" size="sm" onClick={shareLinkedIn}>
              LinkedIn
            </Button>
            <Button variant="outline" size="sm" onClick={shareWhatsApp}>
              WhatsApp
            </Button>
            <Button variant="outline" size="sm" onClick={handleCopyLink}>
              {copied ? (
                <>
                  <Check className="size-3.5" /> Copied
                </>
              ) : (
                <>
                  <Copy className="size-3.5" /> Copy Link
                </>
              )}
            </Button>
          </div>

          {/* Transcript */}
          {segments.length > 0 && (
            <div className="mb-8">
              <h2 className="mb-4 text-lg font-semibold">Transcript</h2>
              <div className="space-y-4">
                {segments.map((seg, i) => (
                  <div key={i} className="rounded-lg border border-border p-3">
                    <div className="mb-1 text-xs font-medium text-violet-400">
                      {seg.speaker}
                    </div>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {seg.text}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* CTA */}
          <div className="rounded-lg border border-border bg-muted/30 p-6 text-center">
            <p className="mb-1 text-lg font-semibold">
              Want to create your own AI podcast?
            </p>
            <p className="mb-4 text-sm text-muted-foreground">
              It's free to try — no account needed.
            </p>
            <Link
              href="/try"
              className={cn(buttonVariants({ size: "lg" }), "h-10 px-6")}
            >
              Make your own podcast
              <ArrowRight className="ml-1 size-4" />
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
