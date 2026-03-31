"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils/index";
import {
  Mic,
  Search,
  FileText,
  Volume2,
  CheckCircle,
  Loader2,
  ArrowRight,
  Headphones,
} from "lucide-react";

// TODO: Add server-side IP rate limiting to prevent abuse.
// Consider using Upstash Redis or similar for distributed rate limiting.
// Suggested limit: 1 generation per IP per 24 hours.

type GenerationStage =
  | "idle"
  | "searching"
  | "summarizing"
  | "scripting"
  | "generating_audio"
  | "completed"
  | "failed";

const stages: { key: GenerationStage; label: string; icon: typeof Search }[] = [
  { key: "searching", label: "Searching latest news", icon: Search },
  { key: "summarizing", label: "Summarizing sources", icon: FileText },
  { key: "scripting", label: "Writing the script", icon: Mic },
  { key: "generating_audio", label: "Generating audio", icon: Volume2 },
];

export default function TryPage() {
  const [topic, setTopic] = useState("");
  const [style, setStyle] = useState<"monologue" | "interview">("monologue");
  const [stage, setStage] = useState<GenerationStage>("idle");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [episodeId, setEpisodeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const isGenerating =
    stage !== "idle" && stage !== "completed" && stage !== "failed";

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!topic.trim() || isGenerating) return;

    setError(null);
    setAudioUrl(null);
    setEpisodeId(null);
    setStage("searching");

    try {
      // Create an anonymous episode via the try API
      const createRes = await fetch("/api/try/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: topic.trim(), style }),
      });

      if (!createRes.ok) {
        const data = await createRes.json().catch(() => ({}));
        throw new Error(data.error || "Failed to start generation");
      }

      const { episodeId: newEpisodeId } = await createRes.json();
      setEpisodeId(newEpisodeId);

      // Poll for status updates
      let currentStage: GenerationStage = "searching";
      while (
        currentStage !== "completed" &&
        currentStage !== "failed"
      ) {
        await new Promise((resolve) => setTimeout(resolve, 2000));

        const statusRes = await fetch(`/api/try/status?id=${newEpisodeId}`);
        if (!statusRes.ok) throw new Error("Failed to check status");

        const statusData = await statusRes.json();
        currentStage = statusData.status as GenerationStage;
        setStage(currentStage);

        if (currentStage === "completed" && statusData.audioUrl) {
          setAudioUrl(statusData.audioUrl);
        }

        if (currentStage === "failed") {
          throw new Error(statusData.error || "Generation failed");
        }
      }
    } catch (err) {
      setStage("failed");
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  function getStageIndex(s: GenerationStage): number {
    const idx = stages.findIndex((st) => st.key === s);
    return idx === -1 ? -1 : idx;
  }

  const currentStageIndex = getStageIndex(stage);

  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <header className="border-b border-border px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <Link href="/" className="text-lg font-bold">
            pod-faster
          </Link>
          <Link
            href="/signup"
            className={cn(buttonVariants({ size: "sm" }), "text-xs")}
          >
            Sign Up Free
          </Link>
        </div>
      </header>

      {/* Main */}
      <main className="flex flex-1 flex-col items-center px-4 py-12 sm:py-20">
        <div className="w-full max-w-xl">
          {/* Hero text */}
          <div className="mb-8 text-center">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-muted/50 px-4 py-1.5 text-sm text-muted-foreground">
              <Headphones className="size-3.5" />
              Free to try — no account needed
            </div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Generate a podcast on{" "}
              <span className="bg-gradient-to-r from-violet-400 to-indigo-400 bg-clip-text text-transparent">
                any topic
              </span>
            </h1>
            <p className="mt-3 text-muted-foreground">
              Enter a topic and we'll create a podcast episode with the latest
              news in under 2 minutes.
            </p>
          </div>

          {/* Form */}
          <Card className="border-0">
            <CardHeader>
              <CardTitle>Create Your Podcast</CardTitle>
              <CardDescription>
                Describe what you want to hear about.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleGenerate} className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="topic">Topic</Label>
                  <Input
                    id="topic"
                    placeholder="e.g. Latest developments in AI, Space exploration news..."
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    disabled={isGenerating}
                    required
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="style">Format</Label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setStyle("monologue")}
                      disabled={isGenerating}
                      className={cn(
                        "flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                        style === "monologue"
                          ? "border-violet-500 bg-violet-600/10 text-violet-400"
                          : "border-border bg-muted/30 text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Mic className="mb-1 inline-block size-4" /> Monologue
                    </button>
                    <button
                      type="button"
                      onClick={() => setStyle("interview")}
                      disabled={isGenerating}
                      className={cn(
                        "flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                        style === "interview"
                          ? "border-violet-500 bg-violet-600/10 text-violet-400"
                          : "border-border bg-muted/30 text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Headphones className="mb-1 inline-block size-4" />{" "}
                      Interview
                    </button>
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={!topic.trim() || isGenerating}
                  className="mt-2 h-10"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>Generate Podcast</>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Progress stages */}
          {stage !== "idle" && (
            <div className="mt-6 space-y-3">
              {stages.map((s, i) => {
                const isActive = s.key === stage;
                const isDone = currentStageIndex > i || stage === "completed";
                const isPending = currentStageIndex < i && stage !== "completed";

                return (
                  <div
                    key={s.key}
                    className={cn(
                      "flex items-center gap-3 rounded-lg border px-4 py-3 text-sm transition-all",
                      isActive &&
                        "border-violet-500/50 bg-violet-600/5 text-foreground",
                      isDone && "border-border bg-muted/30 text-muted-foreground",
                      isPending && "border-transparent text-muted-foreground/50"
                    )}
                  >
                    {isDone ? (
                      <CheckCircle className="size-4 text-green-500" />
                    ) : isActive ? (
                      <Loader2 className="size-4 animate-spin text-violet-400" />
                    ) : (
                      <s.icon className="size-4" />
                    )}
                    {s.label}
                  </div>
                );
              })}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mt-6 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Audio player */}
          {audioUrl && stage === "completed" && (
            <div className="mt-6 space-y-4">
              <div className="rounded-lg border border-violet-500/30 bg-violet-600/5 p-4">
                <p className="mb-3 text-sm font-medium text-violet-400">
                  Your podcast is ready!
                </p>
                <audio
                  ref={audioRef}
                  controls
                  src={audioUrl}
                  className="w-full"
                  autoPlay
                />
                {episodeId && (
                  <div className="mt-3 flex justify-end">
                    <Link
                      href={`/listen/${episodeId}`}
                      className={cn(
                        buttonVariants({ variant: "outline", size: "sm" }),
                        "text-xs"
                      )}
                    >
                      Share this episode
                      <ArrowRight className="ml-1 size-3" />
                    </Link>
                  </div>
                )}
              </div>

              {/* CTA */}
              <div className="rounded-lg border border-border bg-muted/30 p-4 text-center">
                <p className="mb-3 text-sm text-muted-foreground">
                  Want unlimited podcasts with custom voices, more formats, and
                  feed summaries?
                </p>
                <Link
                  href="/signup"
                  className={cn(buttonVariants({ size: "sm" }))}
                >
                  Sign up free
                  <ArrowRight className="ml-1 size-3.5" />
                </Link>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
