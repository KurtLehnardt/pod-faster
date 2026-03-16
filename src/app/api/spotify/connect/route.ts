// TODO: Add rate limiting to this endpoint (see T05 rate limiting task)

/**
 * POST /api/spotify/connect — Initiate Spotify OAuth PKCE flow.
 *
 * Returns a redirect URL for the Spotify authorization page and sets
 * a short-lived cookie containing the PKCE code_verifier and state.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import crypto from "node:crypto";

export async function POST() {
  // 1. Auth check
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Validate required env vars
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    console.error("Missing SPOTIFY_CLIENT_ID or SPOTIFY_REDIRECT_URI");
    return NextResponse.json(
      { error: "Spotify integration is not configured" },
      { status: 503 }
    );
  }

  // 3. Generate PKCE code_verifier (64 random bytes, base64url)
  const codeVerifier = crypto.randomBytes(64).toString("base64url");

  // 4. Generate code_challenge = base64url(SHA-256(codeVerifier))
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  // 5. Generate state (32 random bytes, base64url)
  const state = crypto.randomBytes(32).toString("base64url");

  // 6. Build Spotify auth URL
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    scope: "user-library-read",
    redirect_uri: redirectUri,
    code_challenge_method: "S256",
    code_challenge: codeChallenge,
    state,
  });
  const url = `https://accounts.spotify.com/authorize?${params}`;

  // 6. Store PKCE state in cookie
  const response = NextResponse.json({ url });
  response.cookies.set(
    "spotify_oauth",
    JSON.stringify({ codeVerifier, state }),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600, // 10 minutes
      path: "/api/spotify",
    }
  );

  return response;
}
