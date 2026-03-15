import { NextRequest, NextResponse } from "next/server";
import { gatherNews } from "@/lib/search/gatherer";

interface SearchRequestBody {
  query: string;
  maxResults?: number;
}

function isValidBody(body: unknown): body is SearchRequestBody {
  if (typeof body !== "object" || body === null) return false;
  const obj = body as Record<string, unknown>;
  return typeof obj.query === "string" && obj.query.trim().length > 0;
}

export async function POST(request: NextRequest) {
  // Basic auth check — presence of authorization header
  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  if (!isValidBody(body)) {
    return NextResponse.json(
      { error: "Request body must include a non-empty 'query' string" },
      { status: 400 },
    );
  }

  try {
    const results = await gatherNews({
      queries: [body.query],
      maxResults: body.maxResults ?? 5,
      maxTotal: 10,
    });

    return NextResponse.json({ results });
  } catch (error) {
    console.error("[search] Error:", error);
    return NextResponse.json(
      { error: "Search failed" },
      { status: 502 },
    );
  }
}
