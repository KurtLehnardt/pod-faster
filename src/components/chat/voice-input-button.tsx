"use client";

import { Mic, MicOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface VoiceInputButtonProps {
  isSupported: boolean;
  isListening: boolean;
  onToggle: () => void;
  className?: string;
}

/**
 * Microphone button that starts/stops speech recognition.
 * Hidden on browsers that do not support the Web Speech API.
 */
export function VoiceInputButton({
  isSupported,
  isListening,
  onToggle,
  className,
}: VoiceInputButtonProps) {
  if (!isSupported) return null;

  return (
    <Button
      type="button"
      variant={isListening ? "destructive" : "outline"}
      size="icon"
      onClick={onToggle}
      className={cn(
        "shrink-0",
        isListening && "animate-pulse",
        className
      )}
      aria-label={isListening ? "Stop recording" : "Start voice input"}
    >
      {isListening ? (
        <MicOff className="size-4" />
      ) : (
        <Mic className="size-4" />
      )}
    </Button>
  );
}
