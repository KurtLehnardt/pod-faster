"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Loader2 } from "lucide-react";

interface SpotifyDisconnectDialogProps {
  onDisconnect: (removeData: boolean) => Promise<void>;
}

export function SpotifyDisconnectDialog({
  onDisconnect,
}: SpotifyDisconnectDialogProps) {
  const [removeData, setRemoveData] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [open, setOpen] = useState(false);

  async function handleDisconnect() {
    setIsDisconnecting(true);
    try {
      await onDisconnect(removeData);
      setOpen(false);
    } finally {
      setIsDisconnecting(false);
      setRemoveData(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="destructive" size="sm" />
        }
      >
        Disconnect
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Disconnect Spotify?</DialogTitle>
          <DialogDescription>
            This will remove your Spotify connection. You can reconnect at any
            time.
          </DialogDescription>
        </DialogHeader>

        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-3">
          <span className="text-sm">Also remove imported podcast data</span>
          <Switch
            checked={removeData}
            onCheckedChange={setRemoveData}
            size="sm"
          />
        </label>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <Button
            variant="destructive"
            onClick={handleDisconnect}
            disabled={isDisconnecting}
          >
            {isDisconnecting && (
              <Loader2 className="mr-2 size-4 animate-spin" />
            )}
            Disconnect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
