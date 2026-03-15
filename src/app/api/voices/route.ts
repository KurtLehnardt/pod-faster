import { NextResponse } from "next/server";
import { listVoices } from "@/lib/elevenlabs/voices";
import { ElevenLabsError } from "@/lib/elevenlabs/client";

export async function GET() {
  try {
    const voices = await listVoices();
    return NextResponse.json({ voices });
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
