"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageBubble } from "./message-bubble";
import { VoiceInputButton } from "./voice-input-button";
import { TopicChips } from "./topic-chips";
import { useChat } from "@/lib/hooks/use-chat";
import { useVoiceInput } from "@/lib/hooks/use-voice-input";

const SUGGESTIONS = [
  "What are the latest developments in AI?",
  "Tell me about recent space exploration news",
  "What's happening in the world of renewable energy?",
  "Summarize the latest tech industry news",
];

/**
 * Full chat interface for the pod-faster app.
 * Includes message list, text + voice input, topic chips, and auto-scroll.
 */
export function ChatInterface() {
  const {
    messages,
    isLoading,
    error,
    topics,
    sendMessage,
    removeTopic,
    clearChat,
  } = useChat();

  const {
    isSupported: voiceSupported,
    isListening,
    transcript,
    startListening,
    stopListening,
    clearTranscript,
  } = useVoiceInput();

  const [inputValue, setInputValue] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // When voice transcript updates, append to input
  useEffect(() => {
    if (transcript) {
      setInputValue((prev) => (prev ? prev + " " + transcript : transcript));
      clearTranscript();
    }
  }, [transcript, clearTranscript]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = useCallback(async () => {
    const text = inputValue.trim();
    if (!text) return;

    setInputValue("");
    if (isListening) stopListening();
    await sendMessage(text);
    inputRef.current?.focus();
  }, [inputValue, isListening, stopListening, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleVoiceToggle = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  const handleTopicSelect = useCallback(
    (topic: string) => {
      setInputValue(`Create a podcast episode about: ${topic}`);
      inputRef.current?.focus();
    },
    []
  );

  const hasMessages = messages.length > 0;

  return (
    <div className="flex h-full flex-col">
      {/* Message area */}
      <ScrollArea className="flex-1 overflow-hidden">
        <div ref={scrollRef} className="h-full overflow-y-auto">
          <div className="mx-auto max-w-3xl px-4 py-6">
            {!hasMessages ? (
              <EmptyState onSuggestionClick={sendMessage} />
            ) : (
              <div className="space-y-4">
                {messages.map((message) => (
                  <MessageBubble key={message.id} message={message} />
                ))}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>

      {/* Error display */}
      {error && (
        <div className="border-t border-destructive/20 bg-destructive/5 px-4 py-2">
          <p className="text-sm text-destructive text-center">{error}</p>
        </div>
      )}

      {/* Topic chips */}
      <TopicChips
        topics={topics}
        onRemove={removeTopic}
        onSelect={handleTopicSelect}
      />

      {/* Input area */}
      <div className="border-t border-border bg-background px-4 py-3">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <VoiceInputButton
            isSupported={voiceSupported}
            isListening={isListening}
            onToggle={handleVoiceToggle}
          />

          <Input
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isListening
                ? "Listening..."
                : "Describe a topic you'd like to explore..."
            }
            disabled={isLoading}
            autoFocus
            className="flex-1"
          />

          <Button
            onClick={handleSend}
            disabled={!inputValue.trim() || isLoading}
            size="icon"
            aria-label="Send message"
          >
            <Send className="size-4" />
          </Button>

          {hasMessages && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearChat}
              className="text-xs text-muted-foreground shrink-0"
            >
              Clear
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Welcome screen shown when no messages exist. */
function EmptyState({
  onSuggestionClick,
}: {
  onSuggestionClick: (text: string) => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-6 py-20">
      <div className="text-center">
        <h2 className="text-2xl font-bold tracking-tight">
          What do you want to hear about?
        </h2>
        <p className="mt-2 text-sm text-muted-foreground max-w-md">
          Describe a news topic you are interested in, and I will help you
          explore it and configure a podcast episode.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 max-w-lg w-full">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            onClick={() => onSuggestionClick(suggestion)}
            className="rounded-lg border border-border bg-card px-4 py-3 text-left text-sm text-foreground transition-colors hover:bg-muted"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}
