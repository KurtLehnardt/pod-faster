import { NextRequest, NextResponse } from "next/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// TODO: Real implementation would:
// 1. Look up the episode by ID (no auth required for anonymous/trial episodes)
// 2. Return current pipeline status and audio URL when completed
// 3. Validate the episode belongs to the requesting IP/session

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");

  if (!id || !UUID_RE.test(id)) {
    return NextResponse.json(
      { error: "Valid episode ID is required" },
      { status: 400 }
    );
  }

  // Stub: free trial not yet available
  return NextResponse.json(
    {
      error: "Free trial generation coming soon.",
      comingSoon: true,
    },
    { status: 503 }
  );
}
