import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type AuthSuccess = {
  user: { id: string };
  supabase: Awaited<ReturnType<typeof createClient>>;
  response: null;
};

type AuthFailure = {
  user: null;
  supabase: Awaited<ReturnType<typeof createClient>>;
  response: NextResponse;
};

export async function requireAuth(): Promise<AuthSuccess | AuthFailure> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      user: null,
      supabase,
      response: NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      ),
    };
  }

  return { user, supabase, response: null };
}
