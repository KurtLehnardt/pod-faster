// TODO: Add rate limiting to this endpoint (see T05 rate limiting task)

/**
 * GET /api/spotify/status — Check Spotify connection status.
 *
 * Returns whether Spotify is connected, the linked Spotify account info,
 * subscription count, and last sync timestamp.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getConnectionStatus } from "@/lib/spotify/tokens";

export async function GET() {
  // 1. Auth check
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Get connection status
  try {
    const status = await getConnectionStatus(user.id);
    return NextResponse.json(status);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    // Gracefully handle missing tables (migration not yet applied)
    if (message.includes("does not exist") || message.includes("relation")) {
      return NextResponse.json({ connected: false });
    }
    console.error("Failed to get Spotify status:", message);
    return NextResponse.json(
      { error: "Failed to get connection status" },
      { status: 500 }
    );
  }
}
