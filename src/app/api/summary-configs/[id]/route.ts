/**
 * Summary Config detail -- get, update, delete a single summary config.
 *
 * GET    /api/summary-configs/[id] -- single config with linked feeds and history
 * PUT    /api/summary-configs/[id] -- update config
 * DELETE /api/summary-configs/[id] -- delete config
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/require-auth";
import { updateSummaryConfigSchema } from "@/lib/validation/feed-schemas";
import { computeNextDueAt } from "@/lib/pipeline/summary-pipeline";
import type { SummaryConfig, Cadence } from "@/types/feed";
import type { Json } from "@/types/database.types";

type RouteContext = { params: Promise<{ id: string }> };

// ---------------------------------------------------------------------------
// GET /api/summary-configs/[id]
// ---------------------------------------------------------------------------

export async function GET(
  _request: NextRequest,
  context: RouteContext
) {
  const { id } = await context.params;
  const { user, supabase, response } = await requireAuth();
  if (response) return response;

  // Fetch config with ownership check
  const { data: rawConfig, error: configError } = await supabase
    .from("summary_configs")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (configError || !rawConfig) {
    return NextResponse.json(
      { error: "Summary config not found" },
      { status: 404 }
    );
  }

  const config = rawConfig as unknown as SummaryConfig;

  // Fetch linked feeds
  const { data: rawFeedLinks } = await supabase
    .from("summary_config_feeds")
    .select("feed_id, is_included, auto_excluded, auto_exclude_reason")
    .eq("summary_config_id", id);

  const feedLinks = (rawFeedLinks ?? []) as unknown as {
    feed_id: string;
    is_included: boolean;
    auto_excluded: boolean;
    auto_exclude_reason: string | null;
  }[];

  // Fetch last 10 generation logs
  const { data: rawLogs } = await supabase
    .from("summary_generation_log")
    .select("*")
    .eq("summary_config_id", id)
    .order("started_at", { ascending: false })
    .limit(10);

  return NextResponse.json({
    config: {
      ...config,
      feeds: feedLinks,
      generationHistory: rawLogs ?? [],
    },
  });
}

// ---------------------------------------------------------------------------
// PUT /api/summary-configs/[id]
// ---------------------------------------------------------------------------

export async function PUT(
  request: NextRequest,
  context: RouteContext
) {
  // TODO: Add per-user rate limiting (see rate-limit infrastructure task)
  const { id } = await context.params;
  const { user, supabase, response } = await requireAuth();
  if (response) return response;

  // Ownership check
  const { data: rawExisting, error: existingError } = await supabase
    .from("summary_configs")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (existingError || !rawExisting) {
    return NextResponse.json(
      { error: "Summary config not found" },
      { status: 404 }
    );
  }

  const existing = rawExisting as unknown as SummaryConfig;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updateSummaryConfigSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }

  const { feedIds, ...updateFields } = parsed.data;

  // Build the update object for the summary_configs row
  const updateData: Record<string, unknown> = {};

  if (updateFields.name !== undefined) updateData.name = updateFields.name;
  if (updateFields.cadence !== undefined) updateData.cadence = updateFields.cadence;
  if (updateFields.preferredTime !== undefined) updateData.preferred_time = updateFields.preferredTime;
  if (updateFields.timezone !== undefined) updateData.timezone = updateFields.timezone;
  if (updateFields.style !== undefined) updateData.style = updateFields.style;
  if (updateFields.tone !== undefined) updateData.tone = updateFields.tone;
  if (updateFields.lengthMinutes !== undefined) updateData.length_minutes = updateFields.lengthMinutes;
  if (updateFields.voiceConfig !== undefined) updateData.voice_config = updateFields.voiceConfig as unknown as Json;

  // Recompute next_due_at if cadence changed
  if (updateFields.cadence !== undefined && updateFields.cadence !== existing.cadence) {
    updateData.next_due_at = computeNextDueAt(
      updateFields.cadence as Cadence,
      new Date()
    );
  }

  // Update config row if there are fields to update
  if (Object.keys(updateData).length > 0) {
    const { error: updateError } = await supabase
      .from("summary_configs")
      .update(updateData)
      .eq("id", id);

    if (updateError) {
      console.error("[summary-configs] Update error:", updateError);
      return NextResponse.json(
        { error: "Failed to update summary config" },
        { status: 500 }
      );
    }
  }

  // Sync feed links if feedIds provided
  if (feedIds !== undefined && feedIds.length > 0) {
    // Delete existing links
    const { error: deleteError } = await supabase
      .from("summary_config_feeds")
      .delete()
      .eq("summary_config_id", id);

    if (deleteError) {
      console.error("[summary-configs] Delete feed links error:", deleteError);
    }

    // Insert new links
    const feedRows = feedIds.map((feedId: string) => ({
      summary_config_id: id,
      feed_id: feedId,
      is_included: true,
      auto_excluded: false,
      auto_exclude_reason: null,
    }));

    const { error: insertError } = await supabase
      .from("summary_config_feeds")
      .insert(feedRows);

    if (insertError) {
      // Finding 9: Log the incident when insert fails after delete (atomicity concern)
      console.error(
        "[summary-configs] CRITICAL: Insert feed links failed after delete. " +
        "Feed links for config %s may be in an inconsistent state. " +
        "Manual intervention may be required.",
        id,
        insertError
      );
      return NextResponse.json(
        { error: "Failed to update feed links" },
        { status: 500 }
      );
    }
  }

  // Fetch updated config
  const { data: rawUpdated } = await supabase
    .from("summary_configs")
    .select("*")
    .eq("id", id)
    .single();

  const updated = rawUpdated as unknown as SummaryConfig | null;

  return NextResponse.json({ config: updated });
}

// ---------------------------------------------------------------------------
// DELETE /api/summary-configs/[id]
// ---------------------------------------------------------------------------

export async function DELETE(
  _request: NextRequest,
  context: RouteContext
) {
  // TODO: Add per-user rate limiting (see rate-limit infrastructure task)
  const { id } = await context.params;
  const { user, supabase, response } = await requireAuth();
  if (response) return response;

  // Ownership check + delete
  const { error: deleteError } = await supabase
    .from("summary_configs")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (deleteError) {
    console.error("[summary-configs] Delete error:", deleteError);
    return NextResponse.json(
      { error: "Failed to delete summary config" },
      { status: 500 }
    );
  }

  return NextResponse.json({ deleted: true });
}
