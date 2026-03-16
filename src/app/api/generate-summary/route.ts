/**
 * Trigger summary generation for a summary config.
 *
 * POST /api/generate-summary
 * Body: { summaryConfigId: string }
 *
 * Runs the summary pipeline synchronously within Vercel's function timeout.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  runSummaryPipeline,
  type SummaryPipelineParams,
} from "@/lib/pipeline/summary-pipeline";
import type { EpisodeStyle, EpisodeTone, VoiceConfig } from "@/types/episode";
import type { SummaryConfig } from "@/types/feed";

// Allow up to 300s on Vercel Pro, 60s on Hobby
export const maxDuration = 300;

interface GenerateSummaryBody {
  summaryConfigId: string;
}

function isValidBody(body: unknown): body is GenerateSummaryBody {
  if (typeof body !== "object" || body === null) return false;
  const obj = body as Record<string, unknown>;
  return (
    typeof obj.summaryConfigId === "string" &&
    obj.summaryConfigId.trim().length > 0
  );
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
      {
        error:
          "Request body must include a non-empty 'summaryConfigId' string",
      },
      { status: 400 }
    );
  }

  // Fetch the config — verify ownership
  const { data: rawConfig, error: configError } = await supabase
    .from("summary_configs")
    .select("*")
    .eq("id", body.summaryConfigId)
    .eq("user_id", user.id)
    .single();

  if (configError || !rawConfig) {
    return NextResponse.json(
      { error: "Summary config not found" },
      { status: 404 }
    );
  }

  const config = rawConfig as unknown as SummaryConfig;

  if (!config.is_active) {
    return NextResponse.json(
      { error: "Summary config is inactive. Activate it before generating." },
      { status: 409 }
    );
  }

  // Build pipeline params
  const voiceConfig = config.voice_config as unknown as VoiceConfig | null;
  const pipelineParams: SummaryPipelineParams = {
    summaryConfigId: config.id,
    userId: user.id,
    style: config.style as EpisodeStyle,
    tone: config.tone as EpisodeTone,
    lengthMinutes: config.length_minutes,
    voiceConfig: voiceConfig ?? { voices: [] },
  };

  // Run pipeline synchronously within the function timeout.
  // The client can poll summary_generation_log for progress.
  await runSummaryPipeline(pipelineParams);

  return NextResponse.json({
    started: true,
    summaryConfigId: config.id,
  });
}
