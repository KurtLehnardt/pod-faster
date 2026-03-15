"use client";

/**
 * Persistent audio player bar — fixed at the bottom of the screen.
 * Will hold the full audio player component built in T11.
 * For now: hidden by default, shown only when `visible` is true.
 */

interface PlayerBarProps {
  visible?: boolean;
}

export function PlayerBar({ visible = false }: PlayerBarProps) {
  if (!visible) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 h-20 border-t border-border bg-card">
      <div className="flex h-full items-center justify-center px-4">
        <p className="text-sm text-muted-foreground">
          Audio player placeholder
        </p>
      </div>
    </div>
  );
}
