/**
 * POST /api/spotify/sync — Manually trigger a resync of Spotify subscriptions.
 *
 * Requires authentication and an active Spotify connection.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { syncSubscriptions } from "@/lib/spotify/sync";

export async function POST() {
  // 1. Auth check
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
    console.error("Spotify sync failed:", err);
    return NextResponse.json(
      { error: "Sync failed" },
      { status: 500 }
    );
  }
}
