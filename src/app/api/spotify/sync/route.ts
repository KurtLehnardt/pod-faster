// TODO: Add rate limiting to this endpoint (see T05 rate limiting task)

/**
 * POST /api/spotify/sync — Manually trigger a resync of Spotify subscriptions.
 *
 * Requires authentication and an active Spotify connection.
 */

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/require-auth";
import { syncSubscriptions } from "@/lib/spotify/sync";

export async function POST() {
  // 1. Auth check
  const { user, response } = await requireAuth();
  if (response) return response;

  // 2. Sync subscriptions
  try {
    const result = await syncSubscriptions(user.id);
    return NextResponse.json({ result });
  } catch (err) {
    if (err instanceof Error && err.message === "Spotify not connected") {
      return NextResponse.json(
        { error: "Spotify not connected" },
        { status: 404 }
      );
    }
    console.error(
      "Spotify sync failed:",
      err instanceof Error ? err.message : "Unknown error"
    );
    return NextResponse.json(
      { error: "Sync failed" },
      { status: 500 }
    );
  }
}
