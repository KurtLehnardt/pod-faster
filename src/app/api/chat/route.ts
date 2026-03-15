import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient, MODEL_SONNET, MODEL_HAIKU } from "@/lib/ai/anthropic";
import { chatAssistantSystemPrompt } from "@/lib/ai/chat";
import {
  topicExtractionSystemPrompt,
  topicExtractionUserPrompt,
  parseTopicExtractionResponse,
} from "@/lib/ai/prompts/topic-extraction";
import type { ChatMessage } from "@/types/chat";
import type { ChatRole, Database } from "@/types/database.types";

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

interface ChatRequestBody {
  message: string;
  history: ChatMessage[];
}

function isValidBody(body: unknown): body is ChatRequestBody {
  if (typeof body !== "object" || body === null) return false;
  const obj = body as Record<string, unknown>;
  return (
    typeof obj.message === "string" &&
    obj.message.trim().length > 0 &&
    Array.isArray(obj.history)
  );
}

// ---------------------------------------------------------------------------
// POST /api/chat — streaming chat with topic extraction
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // Authenticate
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Parse body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isValidBody(body)) {
    return NextResponse.json(
      { error: "Request body must include a non-empty 'message' and 'history' array" },
      { status: 400 }
    );
  }

  // Build conversation messages for Claude
  const conversationMessages = body.history
    .filter((m) => m.content.trim().length > 0)
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  // Add the new user message
  conversationMessages.push({ role: "user", content: body.message });

  // Stream the response using SSE
  const encoder = new TextEncoder();
  const readableStream = new ReadableStream({
    async start(controller) {
      try {
        const client = getAnthropicClient();

        // Start streaming the chat response
        const streamResponse = client.messages.stream({
          model: MODEL_SONNET,
          max_tokens: 4096,
          temperature: 0.7,
          system: chatAssistantSystemPrompt(),
          messages: conversationMessages,
        });

        const messageStream = await streamResponse;
        let fullContent = "";

        for await (const event of messageStream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            fullContent += event.delta.text;
            const sseData = JSON.stringify({
              type: "text",
              text: event.delta.text,
            });
            controller.enqueue(encoder.encode(`data: ${sseData}\n\n`));
          }
        }

        // Save messages to DB (fire-and-forget, don't block the stream)
        saveMessages(supabase, user.id, body.message, fullContent).catch(
          (err) => console.error("[chat] Failed to save messages:", err)
        );

        // Extract topics in the background using Haiku (cheap/fast)
        extractTopics(client, body.message, fullContent)
          .then((topics) => {
            if (topics.length > 0) {
              const sseData = JSON.stringify({ type: "topics", topics });
              controller.enqueue(encoder.encode(`data: ${sseData}\n\n`));
            }
          })
          .catch((err) =>
            console.error("[chat] Topic extraction failed:", err)
          )
          .finally(() => {
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          });
      } catch (err) {
        console.error("[chat] Stream error:", err);
        const sseData = JSON.stringify({
          type: "error",
          error: "Failed to generate response",
        });
        controller.enqueue(encoder.encode(`data: ${sseData}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    },
  });

  return new Response(readableStream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// ---------------------------------------------------------------------------
// Save messages to the chat_messages table
// ---------------------------------------------------------------------------

type ChatMessageInsert = Database["public"]["Tables"]["chat_messages"]["Insert"];

async function saveMessages(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  userContent: string,
  assistantContent: string
) {
  const rows: ChatMessageInsert[] = [
    { user_id: userId, role: "user" as ChatRole, content: userContent },
    { user_id: userId, role: "assistant" as ChatRole, content: assistantContent },
  ];

  const { error } = await supabase.from("chat_messages").insert(rows);
  if (error) {
    console.error("[chat] DB insert error:", error.message);
  }
}

// ---------------------------------------------------------------------------
// Extract topics from the conversation using Haiku
// ---------------------------------------------------------------------------

async function extractTopics(
  client: ReturnType<typeof getAnthropicClient>,
  userMessage: string,
  assistantResponse: string
): Promise<string[]> {
  const combinedContext = `User: ${userMessage}\nAssistant: ${assistantResponse}`;

  const response = await client.messages.create({
    model: MODEL_HAIKU,
    max_tokens: 512,
    temperature: 0,
    system: topicExtractionSystemPrompt(),
    messages: [
      {
        role: "user",
        content: topicExtractionUserPrompt({ userMessage: combinedContext }),
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const raw = textBlock && "text" in textBlock ? textBlock.text : "";

  if (!raw) return [];

  try {
    const result = parseTopicExtractionResponse(raw);
    return result.topics;
  } catch {
    return [];
  }
}
