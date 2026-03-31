import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

// TODO: Add IP-based rate limiting (1/day/IP via Upstash Redis)

const generateSchema = z.object({
  topic: z.string().min(1, "Topic is required").max(500, "Topic must be 500 characters or less"),
  style: z.enum(["monologue", "interview"], {
    error: "Style must be 'monologue' or 'interview'",
  }),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const result = generateSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error.issues[0]?.message || "Invalid input" },
        { status: 400 }
      );
    }

    // TODO: Full pipeline integration needed here.
    // The real implementation would:
    // 1. Create an anonymous user or guest session
    // 2. Create an episode record linked to that session
    // 3. Kick off the generation pipeline (search -> summarize -> script -> audio)
    // 4. Return the episode ID for status polling
    //
    // This requires schema changes to support anonymous/guest users.
    // For now, return a clear "coming soon" response.

    return NextResponse.json(
      {
        error: "Free trial generation coming soon. Please sign up for full access.",
        comingSoon: true,
      },
      { status: 503 }
    );
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }
}
