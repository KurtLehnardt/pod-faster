/**
 * Episode CRUD — list and create episodes.
 *
 * GET  /api/episodes       — list user's episodes (paginated)
 * POST /api/episodes       — create a new episode + optionally start pipeline
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { EpisodeStyle, EpisodeTone, VoiceConfig } from "@/types/episode";
import type { Json } from "@/types/database.types";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_STYLES: EpisodeStyle[] = ["monologue", "interview", "group_chat"];
const VALID_TONES: EpisodeTone[] = [
  "serious",
  "lighthearted",
  "dark_mystery",
  "business_news",
];

interface CreateEpisodeBody {
  topicQuery: string;
  style: EpisodeStyle;
  tone: EpisodeTone;
  lengthMinutes?: number;
  voiceConfig: VoiceConfig;
}

function isValidCreateBody(body: unknown): body is CreateEpisodeBody {
  if (typeof body !== "object" || body === null) return false;
  const obj = body as Record<string, unknown>;

  if (typeof obj.topicQuery !== "string" || !obj.topicQuery.trim()) return false;
  if (!VALID_STYLES.includes(obj.style as EpisodeStyle)) return false;
  if (!VALID_TONES.includes(obj.tone as EpisodeTone)) return false;

  if (obj.lengthMinutes !== undefined) {
    if (typeof obj.lengthMinutes !== "number" || obj.lengthMinutes < 1 || obj.lengthMinutes > 30) {
      return false;
    }
  }

  // voiceConfig must have a voices array with at least one entry
  if (typeof obj.voiceConfig !== "object" || obj.voiceConfig === null) return false;
  const vc = obj.voiceConfig as Record<string, unknown>;
  if (!Array.isArray(vc.voices) || vc.voices.length === 0) return false;

  return true;
}

// ---------------------------------------------------------------------------
// GET /api/episodes
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Pagination
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
  const limit = Math.min(
    50,
    Math.max(1, parseInt(url.searchParams.get("limit") ?? "20", 10))
  );
  const offset = (page - 1) * limit;

  const { data: episodes, error, count } = await supabase
    .from("episodes")
    .select("*", { count: "exact" })
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error("[episodes] List error:", error);
    return NextResponse.json(
      { error: "Failed to list episodes" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    episodes: episodes ?? [],
    pagination: {
      page,
      limit,
      total: count ?? 0,
    },
  });
}

// ---------------------------------------------------------------------------
// POST /api/episodes
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isValidCreateBody(body)) {
    return NextResponse.json(
      {
        error:
          "Invalid body. Required: topicQuery (string), style (monologue|interview|group_chat), tone (serious|lighthearted|dark_mystery|business_news), voiceConfig ({ voices: [{ role, voice_id, name }] }). Optional: lengthMinutes (1-30).",
      },
      { status: 400 }
    );
  }

  const { topicQuery, style, tone, lengthMinutes = 5, voiceConfig } = body;

  // Create episode row in pending state
  const { data: episode, error } = await supabase
    .from("episodes")
    .insert({
      user_id: user.id,
      topic_query: topicQuery,
      style,
      tone,
      length_minutes: lengthMinutes,
      voice_config: voiceConfig as unknown as Json,
      status: "pending" as const,
      claude_tokens_used: 0,
      elevenlabs_characters_used: 0,
    })
    .select()
    .single();

  if (error) {
    console.error("[episodes] Create error:", error);
    return NextResponse.json(
      { error: "Failed to create episode" },
      { status: 500 }
    );
  }

  return NextResponse.json({ episode }, { status: 201 });
}
