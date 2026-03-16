/**
 * DELETE /api/spotify/disconnect — Disconnect Spotify account.
 *
 * Best-effort revokes the access token, then deletes stored tokens.
 * If query param remove_data=true, also removes all subscriptions.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { revokeToken } from "@/lib/spotify/client";
import {
  getValidAccessToken,
  deleteTokens,
} from "@/lib/spotify/tokens";
import { removeAllSubscriptions } from "@/lib/spotify/sync";

export async function DELETE(request: NextRequest) {
  // 1. Auth check
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Revoke access token (best-effort)
  try {
    const accessToken = await getValidAccessToken(user.id);
    if (accessToken) {
      await revokeToken(accessToken);
    }
  } catch {
    // Best-effort — continue with disconnect
  }

  // 3. Delete tokens
  try {
    await deleteTokens(user.id);
  } catch (err) {
    console.error("Failed to delete Spotify tokens:", err);
    return NextResponse.json(
      { error: "Failed to disconnect" },
      { status: 500 }
    );
  }

  // 4. Optionally remove subscription data
  const removeData =
    request.nextUrl.searchParams.get("remove_data") === "true";
  if (removeData) {
    try {
      await removeAllSubscriptions(user.id);
    } catch (err) {
      console.error("Failed to remove subscriptions:", err);
      // Tokens are already deleted — still report success
    }
  }

  return NextResponse.json({ disconnected: true });
}
