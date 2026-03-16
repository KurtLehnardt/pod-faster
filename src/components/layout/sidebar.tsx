"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Headphones,
  LogOut,
  MessageSquare,
  Rss,
  Settings,
  Tag,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/episodes", label: "Episodes", icon: Headphones },
  { href: "/feeds", label: "Feeds", icon: Rss },
  { href: "/topics", label: "Topics", icon: Tag },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

interface SidebarProps {
  userEmail: string | null;
  userDisplayName: string | null;
  onNavigate?: () => void;
}

export function Sidebar({ userEmail, userDisplayName, onNavigate }: SidebarProps) {
  const pathname = usePathname();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  const initials = userDisplayName
    ? userDisplayName
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : userEmail
      ? userEmail[0].toUpperCase()
      : "?";

  return (
    <div className="flex h-full flex-col">
      {/* Brand */}
      <div className="flex h-14 items-center px-4">
        <Link
          href="/chat"
          className="flex items-center gap-2 font-semibold tracking-tight"
          onClick={onNavigate}
        >
          <Headphones className="size-5 text-primary" />
          <span className="text-lg">pod-faster</span>
        </Link>
      </div>

      <Separator />

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <item.icon className="size-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <Separator />

      {/* User section */}
      <div className="p-3">
        <div className="flex items-center gap-3 rounded-lg px-3 py-2">
          <Avatar size="sm">
            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
          </Avatar>
          <div className="flex-1 truncate">
            <p className="truncate text-sm font-medium">
              {userDisplayName || userEmail || "User"}
            </p>
          </div>
          <button
            onClick={handleSignOut}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Sign out"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
