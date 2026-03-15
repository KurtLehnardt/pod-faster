"use client";

import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface TopicChipsProps {
  topics: string[];
  onRemove: (topic: string) => void;
  onSelect: (topic: string) => void;
}

/**
 * Displays extracted topic chips between the message list and the input.
 * Each chip is clickable (to start episode generation) and removable.
 */
export function TopicChips({ topics, onRemove, onSelect }: TopicChipsProps) {
  if (topics.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 px-4 py-2 border-t border-border bg-background/80">
      <span className="text-xs text-muted-foreground self-center mr-1">
        Topics:
      </span>
      {topics.map((topic) => (
        <Badge
          key={topic}
          variant="secondary"
          className="cursor-pointer gap-1 pr-1 hover:bg-secondary/80 transition-colors"
        >
          <button
            type="button"
            onClick={() => onSelect(topic)}
            className="text-xs"
          >
            {topic}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(topic);
            }}
            className="ml-0.5 rounded-full p-0.5 hover:bg-foreground/10 transition-colors"
            aria-label={`Remove ${topic}`}
          >
            <X className="size-2.5" />
          </button>
        </Badge>
      ))}
    </div>
  );
}
