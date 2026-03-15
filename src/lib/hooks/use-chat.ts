"use client";

import { useState, useCallback, useRef } from "react";
import type { ChatMessage } from "@/types/chat";

export interface UseChatReturn {
  /** All messages in the conversation */
  messages: ChatMessage[];
  /** Whether the AI is currently generating a response */
  isLoading: boolean;
  /** Last error, if any */
  error: string | null;
  /** Topics extracted from the conversation */
  topics: string[];
  /** Send a new user message */
  sendMessage: (content: string) => Promise<void>;
  /** Remove a topic from the list */
  removeTopic: (topic: string) => void;
  /** Clear all messages and start fresh */
  clearChat: () => void;
}

/**
 * Manages chat state: messages, streaming responses, and topic extraction.
 * Sends messages to /api/chat and handles the streaming response.
 */
export function useChat(): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [topics, setTopics] = useState<string[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || isLoading) return;

      setError(null);

      // Add the user message immediately
      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: content.trim(),
        created_at: new Date().toISOString(),
      };

      const updatedMessages = [...messages, userMessage];
      setMessages(updatedMessages);
      setIsLoading(true);

      // Create placeholder for assistant message
      const assistantId = crypto.randomUUID();
      const assistantMessage: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        created_at: new Date().toISOString(),
      };

      setMessages([...updatedMessages, assistantMessage]);

      // Abort any in-flight request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: content.trim(),
            history: updatedMessages,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => null);
          throw new Error(
            errorData?.error ?? `Chat request failed (${response.status})`
          );
        }

        if (!response.body) {
          throw new Error("No response body received");
        }

        // Read the streaming response
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullContent = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6);

            if (data === "[DONE]") continue;

            try {
              const parsed = JSON.parse(data) as {
                type: string;
                text?: string;
                topics?: string[];
              };

              if (parsed.type === "text" && parsed.text) {
                fullContent += parsed.text;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? { ...m, content: fullContent }
                      : m
                  )
                );
              }

              if (parsed.type === "topics" && parsed.topics) {
                setTopics((prev) => {
                  const combined = new Set([...prev, ...parsed.topics!]);
                  return Array.from(combined);
                });
              }
            } catch {
              // Skip malformed SSE lines
            }
          }
        }

        // Finalize the assistant message timestamp
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: fullContent, created_at: new Date().toISOString() }
              : m
          )
        );
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          // Request was intentionally aborted
          return;
        }

        const message =
          err instanceof Error ? err.message : "Something went wrong";
        setError(message);

        // Remove the empty assistant message on error
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
      } finally {
        setIsLoading(false);
        abortControllerRef.current = null;
      }
    },
    [messages, isLoading]
  );

  const removeTopic = useCallback((topic: string) => {
    setTopics((prev) => prev.filter((t) => t !== topic));
  }, []);

  const clearChat = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setMessages([]);
    setTopics([]);
    setError(null);
    setIsLoading(false);
  }, []);

  return {
    messages,
    isLoading,
    error,
    topics,
    sendMessage,
    removeTopic,
    clearChat,
  };
}
