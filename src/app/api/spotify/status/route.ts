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
    console.error("Failed to get Spotify status:", err);
    return NextResponse.json(
      { error: "Failed to get connection status" },
      { status: 500 }
    );
  }
}
