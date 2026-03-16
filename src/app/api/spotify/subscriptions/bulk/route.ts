/**
 * PATCH /api/spotify/subscriptions/bulk — Bulk update summarization preferences.
 *
 * Body: { updates: Array<{ id: string, summarization_enabled: boolean }> }
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { bulkUpdatePreferences } from "@/lib/spotify/sync";

export async function PATCH(request: NextRequest) {
  // 1. Auth check
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Parse and validate body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json(
      { error: "Body must contain updates array" },
      { status: 400 }
    );
  }

  const { updates } = body as Record<string, unknown>;

  if (!Array.isArray(updates) || updates.length === 0) {
    return NextResponse.json(
      { error: "updates must be a non-empty array" },
      { status: 400 }
    );
  }

  if (updates.length > 100) {
    return NextResponse.json(
      { error: "updates array must not exceed 100 items" },
      { status: 400 }
    );
  }

  // Validate each entry
  for (const entry of updates) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as Record<string, unknown>).id !== "string" ||
      typeof (entry as Record<string, unknown>).summarization_enabled !==
        "boolean"
    ) {
      return NextResponse.json(
        {
          error:
            "Each update must have id (string) and summarization_enabled (boolean)",
        },
        { status: 400 }
      );
    }
  }

  const typedUpdates = updates as {
    id: string;
    summarization_enabled: boolean;
  }[];

  // 3. Bulk update
  try {
    await bulkUpdatePreferences(user.id, typedUpdates);
    return NextResponse.json({ updated: typedUpdates.length });
  } catch (err) {
    console.error("Failed to bulk update preferences:", err);
    return NextResponse.json(
      { error: "Failed to bulk update preferences" },
      { status: 500 }
    );
  }
}
