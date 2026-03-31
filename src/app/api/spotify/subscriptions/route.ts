// TODO: Add rate limiting to this endpoint (see T05 rate limiting task)

/**
 * GET /api/spotify/subscriptions — List user's Spotify podcast subscriptions.
 *
 * Query params:
 *   include_removed — if "true", includes soft-removed subscriptions.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/require-auth";
import { getSubscriptions } from "@/lib/spotify/sync";

export async function GET(request: NextRequest) {
  // 1. Auth check
  const { user, response } = await requireAuth();
  if (response) return response;

  // 2. Parse query params
  const includeRemoved =
    request.nextUrl.searchParams.get("include_removed") === "true";

  // 3. Fetch subscriptions
  try {
    const subscriptions = await getSubscriptions(user.id, { includeRemoved });
    return NextResponse.json({ subscriptions });
  } catch (err) {
    console.error(
      "Failed to fetch subscriptions:",
      err instanceof Error ? err.message : "Unknown error"
    );
    return NextResponse.json(
      { error: "Failed to fetch subscriptions" },
      { status: 500 }
    );
  }
}
