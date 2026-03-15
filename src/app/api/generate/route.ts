/**
 * Trigger generation — start the pipeline for an episode.
 *
 * POST /api/generate
 * Body: { episodeId: string }
 *
 * Runs the pipeline synchronously so it works within Vercel's function
 * timeout. Set maxDuration to allow enough time for the full pipeline.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { EpisodeStyle, EpisodeTone, VoiceConfig } from "@/types/episode";
import { runPipeline } from "@/lib/pipeline/orchestrator";

// Allow up to 300s on Vercel Pro, 60s on Hobby
export const maxDuration = 300;

interface GenerateBody {
  episodeId: string;
}

function isValidBody(body: unknown): body is GenerateBody {
  if (typeof body !== "object" || body === null) return false;
  const obj = body as Record<string, unknown>;
  return typeof obj.episodeId === "string" && obj.episodeId.trim().length > 0;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isValidBody(body)) {
    return NextResponse.json(
      { error: "Request body must include a non-empty 'episodeId' string" },
      { status: 400 }
    );
  }

  // Fetch the episode — verify ownership and that it's in a startable state
  const { data: episode, error } = await supabase
    .from("episodes")
    .select("*")
    .eq("id", body.episodeId)
    .eq("user_id", user.id)
    .single<{
      id: string;
      user_id: string;
      status: string;
      topic_query: string;
      style: string;
      tone: string;
      length_minutes: number;
      voice_config: unknown;
    }>();

  if (error || !episode) {
    return NextResponse.json({ error: "Episode not found" }, { status: 404 });
  }

  if (episode.status !== "pending" && episode.status !== "failed") {
    return NextResponse.json(
      {
        error: `Episode is already ${episode.status}. Only 'pending' or 'failed' episodes can be generated.`,
      },
      { status: 409 }
    );
  }

  const voiceConfig = episode.voice_config as unknown as VoiceConfig | null;
  if (!voiceConfig?.voices?.length) {
    return NextResponse.json(
      { error: "Episode has no voice configuration" },
      { status: 400 }
    );
  }

  // Run pipeline synchronously within the function timeout.
  // The client polls episode status for progress updates.
  await runPipeline({
    episodeId: episode.id,
    userId: user.id,
    topicQuery: episode.topic_query,
    style: episode.style as EpisodeStyle,
    tone: episode.tone as EpisodeTone,
    lengthMinutes: episode.length_minutes,
    voiceConfig,
  });

  return NextResponse.json({
    started: true,
    episodeId: episode.id,
  });
}
