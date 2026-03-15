"use client";

/**
 * Persistent audio player bar — fixed at the bottom of the screen.
 * Renders the compact AudioPlayer when an episode is loaded.
 */

import { AudioPlayer } from "@/components/player/audio-player";
import { useAudioPlayer } from "@/lib/hooks/use-audio-player";

export function PlayerBar() {
  const { currentEpisode } = useAudioPlayer();

  if (!currentEpisode) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 h-20 border-t border-border bg-card/95 backdrop-blur-sm">
      <div className="flex h-full flex-col justify-center">
        <AudioPlayer compact />
      </div>
    </div>
  );
}
