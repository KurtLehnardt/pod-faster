import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/require-auth";
import { listVoices } from "@/lib/elevenlabs/voices";
import { ElevenLabsError } from "@/lib/elevenlabs/client";

export async function GET() {
  const { response } = await requireAuth();
  if (response) return response;

  try {
    const voices = await listVoices();
    return NextResponse.json({ voices }, {
      headers: { "Cache-Control": "public, max-age=3600" },
    });
  } catch (error) {
    if (error instanceof ElevenLabsError) {
      // Return empty list when API key is not configured
      if (error.status === 503) {
        return NextResponse.json({ voices: [] });
      }
      return NextResponse.json(
        { error: "Failed to fetch voices", detail: error.message },
        { status: error.status >= 500 ? 502 : error.status }
      );
    }
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
