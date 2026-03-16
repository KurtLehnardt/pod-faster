/**
 * Shared authentication helper for API route handlers.
 *
 * Centralises the repeated pattern of:
 *   createClient() -> auth.getUser() -> 401 if missing
 *
 * Usage:
 *   const auth = await requireAuth();
 *   if (auth.error) return auth.error;   // already a 401 Response
 *   const { user, supabase } = auth;
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

type AuthSuccess = {
  user: User;
  supabase: SupabaseClient<Database>;
  error: null;
};

type AuthFailure = {
  user: null;
  supabase: SupabaseClient<Database>;
  error: NextResponse;
};

export type AuthResult = AuthSuccess | AuthFailure;

export async function requireAuth(): Promise<AuthResult> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      user: null,
      supabase,
      error: NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      ),
    };
  }

  return { user, supabase, error: null };
}
