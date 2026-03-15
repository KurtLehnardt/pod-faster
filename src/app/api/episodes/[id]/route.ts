/**
 * Single episode — get details or delete.
 *
 * GET    /api/episodes/[id]  — get episode details
 * DELETE /api/episodes/[id]  — delete episode + audio
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type RouteParams = { params: Promise<{ id: string }> };

// ---------------------------------------------------------------------------
// GET /api/episodes/[id]
// ---------------------------------------------------------------------------

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

  const { data: episode, error } = await supabase
    .from("episodes")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (error || !episode) {
    return NextResponse.json({ error: "Episode not found" }, { status: 404 });
  }

  return NextResponse.json({ episode });
}

// ---------------------------------------------------------------------------
// DELETE /api/episodes/[id]
// ---------------------------------------------------------------------------

export async function DELETE(
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

  // Fetch episode to get audio_path before deleting
  const { data: episode, error: fetchError } = await supabase
    .from("episodes")
    .select("id, user_id, audio_path")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (fetchError || !episode) {
    return NextResponse.json({ error: "Episode not found" }, { status: 404 });
  }

  // Delete audio from storage if it exists
  if (episode.audio_path) {
    const admin = createAdminClient();
    const { error: storageError } = await admin.storage
      .from("podcasts")
      .remove([episode.audio_path]);

    if (storageError) {
      console.error(
        `[episodes] Failed to delete audio for ${id}:`,
        storageError
      );
      // Continue with episode deletion even if storage cleanup fails
    }
  }

  // Delete episode row
  const { error: deleteError } = await supabase
    .from("episodes")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (deleteError) {
    console.error("[episodes] Delete error:", deleteError);
    return NextResponse.json(
      { error: "Failed to delete episode" },
      { status: 500 }
    );
  }

  return NextResponse.json({ deleted: true });
}
