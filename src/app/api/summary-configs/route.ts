/**
 * Summary Config CRUD — list and create summary configs.
 *
 * GET  /api/summary-configs       — list user's summary configs
 * POST /api/summary-configs       — create a new summary config + link feeds
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createSummaryConfigSchema } from "@/lib/validation/feed-schemas";
import { computeNextDueAt } from "@/lib/pipeline/summary-pipeline";
import type { SummaryConfig } from "@/types/feed";
import type { Json } from "@/types/database.types";

// ---------------------------------------------------------------------------
// GET /api/summary-configs
// ---------------------------------------------------------------------------

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Fetch user's summary configs
  const { data: rawConfigs, error: configsError } = await supabase
    .from("summary_configs")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (configsError) {
    console.error("[summary-configs] List error:", configsError);
    return NextResponse.json(
      { error: "Failed to list summary configs" },
      { status: 500 }
    );
  }

  const configs = (rawConfigs ?? []) as unknown as SummaryConfig[];

  // Fetch linked feed IDs for each config
  const configIds = configs.map((c) => c.id);

  let feedLinks: { summary_config_id: string; feed_id: string }[] = [];
  if (configIds.length > 0) {
    const { data: links, error: linksError } = await supabase
      .from("summary_config_feeds")
      .select("summary_config_id, feed_id")
      .in("summary_config_id", configIds);

    if (linksError) {
      console.error("[summary-configs] Feed links error:", linksError);
    } else {
      feedLinks = (links ?? []) as unknown as {
        summary_config_id: string;
        feed_id: string;
      }[];
    }
  }

  // Group feed IDs by config ID
  const feedsByConfig = new Map<string, string[]>();
  for (const link of feedLinks) {
    const existing = feedsByConfig.get(link.summary_config_id) ?? [];
    existing.push(link.feed_id);
    feedsByConfig.set(link.summary_config_id, existing);
  }

  const configsWithFeeds = configs.map((config) => ({
    ...config,
    feedIds: feedsByConfig.get(config.id) ?? [],
  }));

  return NextResponse.json({ configs: configsWithFeeds });
}

// ---------------------------------------------------------------------------
// POST /api/summary-configs
// ---------------------------------------------------------------------------

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

  const parsed = createSummaryConfigSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }

  const {
    name,
    cadence,
    preferredTime,
    timezone,
    style,
    tone,
    lengthMinutes,
    voiceConfig,
    feedIds,
  } = parsed.data;

  // Compute initial next_due_at
  const nextDueAt = computeNextDueAt(cadence, new Date());

  // Insert summary config
  const { data: rawConfig, error: insertError } = await supabase
    .from("summary_configs")
    .insert({
      user_id: user.id,
      name,
      cadence,
      preferred_time: preferredTime ?? null,
      timezone: timezone ?? null,
      style,
      tone,
      length_minutes: lengthMinutes,
      voice_config: (voiceConfig as unknown as Json) ?? null,
      is_active: true,
      next_due_at: nextDueAt,
    })
    .select()
    .single();

  if (insertError || !rawConfig) {
    console.error("[summary-configs] Create error:", insertError);
    return NextResponse.json(
      { error: "Failed to create summary config" },
      { status: 500 }
    );
  }

  const config = rawConfig as unknown as SummaryConfig;

  // Insert summary_config_feeds rows
  const feedRows = feedIds.map((feedId) => ({
    summary_config_id: config.id,
    feed_id: feedId,
    is_included: true,
    auto_excluded: false,
    auto_exclude_reason: null,
  }));

  const { error: feedsError } = await supabase
    .from("summary_config_feeds")
    .insert(feedRows);

  if (feedsError) {
    console.error("[summary-configs] Feed links error:", feedsError);
    // Config was created; log the error but return the config
  }

  return NextResponse.json(
    { config: { ...config, feedIds } },
    { status: 201 }
  );
}
