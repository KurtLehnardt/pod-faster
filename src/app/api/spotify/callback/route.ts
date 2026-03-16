// TODO: Add rate limiting to this endpoint (see T05 rate limiting task)

/**
 * GET /api/spotify/callback — Handle Spotify OAuth callback.
 *
 * Validates the PKCE state, exchanges the authorization code for tokens,
 * fetches the user profile, stores tokens, and triggers an initial sync.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  exchangeCodeForTokens,
  fetchUserProfile,
} from "@/lib/spotify/client";
import { storeTokens } from "@/lib/spotify/tokens";
import { syncSubscriptions } from "@/lib/spotify/sync";

export async function GET(request: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  // 1. Auth check
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(`${appUrl}/login`);
  }

  // 2. Get code and state from query params
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const error = request.nextUrl.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      `${appUrl}/settings?spotify=error&reason=${encodeURIComponent(error)}`
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      `${appUrl}/settings?spotify=error&reason=missing_params`
    );
  }

  // 3. Read and verify PKCE cookie
  const cookieValue = request.cookies.get("spotify_oauth")?.value;
  if (!cookieValue) {
    return NextResponse.redirect(
      `${appUrl}/settings?spotify=error&reason=expired`
    );
  }

  let oauthState: { codeVerifier: string; state: string };
  try {
    oauthState = JSON.parse(cookieValue);
  } catch {
    return NextResponse.redirect(
      `${appUrl}/settings?spotify=error&reason=invalid_cookie`
    );
  }

  if (state !== oauthState.state) {
    return NextResponse.redirect(
      `${appUrl}/settings?spotify=error&reason=state_mismatch`
    );
  }

  // 4. Exchange code for tokens
  try {
    const tokens = await exchangeCodeForTokens(code, oauthState.codeVerifier);
    const profile = await fetchUserProfile(tokens.access_token);
    await storeTokens(user.id, tokens, profile);

    // 5. Initial sync (must await on serverless — execution may terminate otherwise)
    await syncSubscriptions(user.id);

    // 6. Redirect to settings, clear cookie
    const response = NextResponse.redirect(
      `${appUrl}/settings?spotify=connected`
    );
    response.cookies.set("spotify_oauth", "", {
      maxAge: 0,
      path: "/api/spotify",
    });
    return response;
  } catch (err) {
    console.error("Spotify OAuth callback failed:", err);
    return NextResponse.redirect(
      `${appUrl}/settings?spotify=error&reason=exchange_failed`
    );
  }
}
