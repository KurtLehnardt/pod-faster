"use client";

import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/types/chat";

interface MessageBubbleProps {
  message: ChatMessage;
}

/**
 * Renders a single chat message. User messages are right-aligned with primary
 * color. Assistant messages are left-aligned with a muted background and
 * support basic markdown-like rendering (paragraphs, bold, inline code).
 */
export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const time = formatTime(message.created_at);

  return (
    <div
      className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}
    >
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed md:max-w-[70%]",
          isUser
            ? "bg-primary text-primary-foreground rounded-br-md"
            : "bg-muted text-foreground rounded-bl-md"
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <AssistantContent content={message.content} />
        )}
        <p
          className={cn(
            "mt-1 text-[10px]",
            isUser
              ? "text-primary-foreground/60 text-right"
              : "text-muted-foreground text-left"
          )}
        >
          {time}
        </p>
      </div>
    </div>
  );
}

/**
 * Simple markdown-like rendering for assistant messages.
 * Handles: paragraphs, **bold**, `inline code`, and line breaks.
 * No heavy markdown library needed for chat-quality output.
 */
function AssistantContent({ content }: { content: string }) {
  if (!content) {
    return <TypingIndicator />;
  }

  const paragraphs = content.split(/\n\n+/);

  return (
    <div className="space-y-2">
      {paragraphs.map((paragraph, i) => (
        <p key={i} className="whitespace-pre-wrap">
          {renderInlineFormatting(paragraph)}
        </p>
      ))}
    </div>
  );
}

function renderInlineFormatting(text: string): React.ReactNode[] {
  // Split on bold (**text**) and inline code (`text`) patterns
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);

  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={i}
          className="rounded bg-foreground/10 px-1 py-0.5 text-xs font-mono"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

/** Animated dots indicator shown while the assistant is generating. */
export function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 py-1" aria-label="AI is thinking">
      <span className="size-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:0ms]" />
      <span className="size-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:150ms]" />
      <span className="size-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:300ms]" />
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}
