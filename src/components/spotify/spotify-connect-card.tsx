"use client";

import { useState } from "react";
import { Music, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface SpotifyConnectCardProps {
  onConnect: () => Promise<void>;
}

export function SpotifyConnectCard({ onConnect }: SpotifyConnectCardProps) {
  const [isConnecting, setIsConnecting] = useState(false);

  async function handleConnect() {
    setIsConnecting(true);
    try {
      await onConnect();
    } finally {
      setIsConnecting(false);
    }
  }

  return (
    <Card className="border-green-500/20 bg-green-500/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Music className="size-5 text-green-500" />
          Spotify
        </CardTitle>
        <CardDescription>
          Connect your Spotify account to automatically import your podcast
          subscriptions.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          onClick={handleConnect}
          disabled={isConnecting}
          className="bg-green-600 text-white hover:bg-green-700"
        >
          {isConnecting ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <Music className="mr-2 size-4" />
          )}
          Connect Spotify
        </Button>
      </CardContent>
    </Card>
  );
}
