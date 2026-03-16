/**
 * Vercel Cron endpoint -- generate due summary podcasts.
 *
 * GET /api/cron/generate-summaries
 *
 * Validates CRON_SECRET header. Queries active summary configs
 * where next_due_at <= now(), runs the pipeline for each.
 */

import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  runSummaryPipeline,
  type SummaryPipelineParams,
} from "@/lib/pipeline/summary-pipeline";
import type { EpisodeStyle, EpisodeTone, VoiceConfig } from "@/types/episode";
import type { Cadence, SummaryConfig } from "@/types/feed";

export const maxDuration = 300;

/**
 * Map cadence to the minimum interval in milliseconds.
 * Used for idempotency: skip if last_generated_at is within half the cadence.
 */
function cadenceHalfIntervalMs(cadence: Cadence): number {
  switch (cadence) {
    case "daily":
      return 12 * 60 * 60 * 1000; // 12 hours
    case "twice_weekly":
      return 36 * 60 * 60 * 1000; // 1.5 days
    case "weekly":
      return 84 * 60 * 60 * 1000; // 3.5 days
    case "on_new_episodes":
      return 12 * 60 * 60 * 1000; // 12 hours
  }
}

export async function GET(request: NextRequest) {
  // Validate cron secret
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error("[cron/generate-summaries] CRON_SECRET not configured");
    return NextResponse.json(
      { error: "Cron endpoint not configured" },
      { status: 500 }
    );
  }

  // Timing-safe comparison to prevent timing attacks
  const expected = Buffer.from(`Bearer ${cronSecret}`);
  const provided = Buffer.from(authHeader ?? "");
  if (
    expected.length !== provided.length ||
    !crypto.timingSafeEqual(expected, provided)
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const now = new Date().toISOString();

  // Query active summary configs that are due (bounded to 10 to prevent unbounded work)
  const { data: rawConfigs, error: queryError } = await supabase
    .from("summary_configs")
    .select("*")
    .eq("is_active", true)
    .lte("next_due_at", now)
    .limit(10);

  if (queryError) {
    console.error("[cron/generate-summaries] Query error:", queryError);
    return NextResponse.json(
      { error: "Failed to query due configs" },
      { status: 500 }
    );
  }

  const dueConfigs = (rawConfigs ?? []) as unknown as SummaryConfig[];

  if (dueConfigs.length === 0) {
    return NextResponse.json({ processed: 0, skipped: 0 });
  }

  // Process configs in parallel with Promise.allSettled
  const results = await Promise.allSettled(
    dueConfigs.map(async (config) => {
      const cadence = config.cadence as Cadence;

      // Idempotency check: skip if last_generated_at is within half the cadence
      if (config.last_generated_at) {
        const lastGenTime = new Date(config.last_generated_at).getTime();
        const halfInterval = cadenceHalfIntervalMs(cadence);

        if (Date.now() - lastGenTime < halfInterval) {
          console.log(
            `[cron/generate-summaries] Skipping config ${config.id} -- generated too recently`
          );
          return "skipped" as const;
        }
      }

      const voiceConfig = config.voice_config as unknown as VoiceConfig | null;

      const pipelineParams: SummaryPipelineParams = {
        summaryConfigId: config.id,
        userId: config.user_id,
        style: config.style as EpisodeStyle,
        tone: config.tone as EpisodeTone,
        lengthMinutes: config.length_minutes,
        voiceConfig: voiceConfig ?? { voices: [] },
      };

      await runSummaryPipeline(pipelineParams);
      return "processed" as const;
    })
  );

  let processed = 0;
  let skipped = 0;

  for (const result of results) {
    if (result.status === "fulfilled") {
      if (result.value === "processed") {
        processed++;
      } else {
        skipped++;
      }
    } else {
      console.error(
        "[cron/generate-summaries] Pipeline failed:",
        result.reason
      );
      skipped++;
    }
  }

  return NextResponse.json({ processed, skipped });
}
