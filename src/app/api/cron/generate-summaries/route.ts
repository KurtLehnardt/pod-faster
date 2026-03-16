/**
 * Vercel Cron endpoint — generate due summary podcasts.
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
 * Maximum number of configs to process per cron invocation.
 * If there are more due configs than this, they will be picked up
 * in subsequent cron runs. Consider increasing cron frequency if
 * this limit is regularly hit.
 */
const MAX_CONFIGS_PER_RUN = 10;

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

  // Timing-safe comparison to prevent timing attacks on the secret
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

  // Query active summary configs that are due, limited to MAX_CONFIGS_PER_RUN
  const { data: rawConfigs, error: queryError } = await supabase
    .from("summary_configs")
    .select("*")
    .eq("is_active", true)
    .lte("next_due_at", now)
    .limit(MAX_CONFIGS_PER_RUN);

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

  // Filter out configs that were generated too recently (idempotency)
  const configsToProcess: SummaryConfig[] = [];
  let skipped = 0;

  for (const config of dueConfigs) {
    const cadence = config.cadence as Cadence;

    if (config.last_generated_at) {
      const lastGenTime = new Date(config.last_generated_at).getTime();
      const halfInterval = cadenceHalfIntervalMs(cadence);

      if (Date.now() - lastGenTime < halfInterval) {
        console.log(
          `[cron/generate-summaries] Skipping config ${config.id} — generated too recently`
        );
        skipped++;
        continue;
      }
    }

    configsToProcess.push(config);
  }

  // Process all eligible configs in parallel
  const results = await Promise.allSettled(
    configsToProcess.map(async (config) => {
      const cadence = config.cadence as Cadence;
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
      return cadence; // return for logging if needed
    })
  );

  let processed = 0;
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") {
      processed++;
    } else {
      console.error(
        `[cron/generate-summaries] Pipeline failed for config ${configsToProcess[i].id}:`,
        result.reason
      );
      skipped++;
    }
  }

  return NextResponse.json({ processed, skipped });
}
