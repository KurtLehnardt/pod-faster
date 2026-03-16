/**
 * GET /api/spotify/subscriptions — List user's Spotify podcast subscriptions.
 *
 * Query params:
 *   include_removed — if "true", includes soft-removed subscriptions.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSubscriptions } from "@/lib/spotify/sync";

export async function GET(request: NextRequest) {
  // 1. Auth check
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Parse query params
  const includeRemoved =
    request.nextUrl.searchParams.get("include_removed") === "true";

  // 3. Fetch subscriptions
  try {
    const subscriptions = await getSubscriptions(user.id, { includeRemoved });
    return NextResponse.json({ subscriptions });
  } catch (err) {
    console.error("Failed to fetch subscriptions:", err);
    return NextResponse.json(
      { error: "Failed to fetch subscriptions" },
      { status: 500 }
    );
  }
}
