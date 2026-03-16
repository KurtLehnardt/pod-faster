/**
 * PATCH /api/spotify/subscriptions/[id] — Toggle summarization preference.
 *
 * Body: { summarization_enabled: boolean }
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { updateSubscriptionPreference } from "@/lib/spotify/sync";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>).summarization_enabled !== "boolean"
  ) {
    return NextResponse.json(
      { error: "Body must contain summarization_enabled (boolean)" },
      { status: 400 }
    );
  }

  const { summarization_enabled } = body as { summarization_enabled: boolean };
  const { id } = await params;

  // 3. Update preference
  try {
    await updateSubscriptionPreference(user.id, id, summarization_enabled);
    return NextResponse.json({ updated: true });
  } catch (err) {
    console.error("Failed to update subscription preference:", err);
    return NextResponse.json(
      { error: "Failed to update preference" },
      { status: 500 }
    );
  }
}
