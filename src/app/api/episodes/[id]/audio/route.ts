/**
 * Audio streaming — get a signed URL for the episode's audio file.
 *
 * GET /api/episodes/[id]/audio — returns a signed URL for the audio
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/** Signed URL validity in seconds (1 hour). */
const SIGNED_URL_TTL = 3600;

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(
  _request: NextRequest,
  { params }: RouteParams
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Fetch episode — RLS ensures user can only see their own
  const { data: episode, error } = await supabase
    .from("episodes")
    .select("id, user_id, audio_path, status")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (error || !episode) {
    return NextResponse.json({ error: "Episode not found" }, { status: 404 });
  }

  if (episode.status !== "completed" || !episode.audio_path) {
    return NextResponse.json(
      { error: "Audio not available. Episode status: " + episode.status },
      { status: 404 }
    );
  }

  // Generate signed URL using admin client (storage may not have RLS configured for reads)
  const admin = createAdminClient();
  const { data: signedUrl, error: urlError } = await admin.storage
    .from("podcasts")
    .createSignedUrl(episode.audio_path, SIGNED_URL_TTL);

  if (urlError || !signedUrl) {
    console.error("[audio] Signed URL error:", urlError);
    return NextResponse.json(
      { error: "Failed to generate audio URL" },
      { status: 500 }
    );
  }

  return NextResponse.json({ url: signedUrl.signedUrl });
}
