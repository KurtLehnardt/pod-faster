"use client";

import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";

const pageTitles: Record<string, string> = {
  "/chat": "Chat",
  "/episodes": "Episodes",
  "/topics": "Topics",
  "/settings": "Settings",
};

function getPageTitle(pathname: string): string {
  // Exact match first
  if (pageTitles[pathname]) return pageTitles[pathname];

  // Check prefixes for nested routes
  if (pathname.startsWith("/episodes/")) return "Episode Detail";

  // Fallback
  for (const [prefix, title] of Object.entries(pageTitles)) {
    if (pathname.startsWith(prefix + "/")) return title;
  }

  return "pod-faster";
}

interface HeaderProps {
  onMenuToggle: () => void;
}

export function Header({ onMenuToggle }: HeaderProps) {
  const pathname = usePathname();
  const title = getPageTitle(pathname);

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4 lg:px-6">
      <Button
        variant="ghost"
        size="icon-sm"
        className="lg:hidden"
        onClick={onMenuToggle}
        aria-label="Toggle navigation menu"
      >
        <Menu className="size-5" />
      </Button>
      <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
    </header>
  );
}
