"use client";

import { useEffect, useState } from "react";
import { Loader2, Music } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PreferencesForm } from "@/components/settings/preferences-form";
import { Separator } from "@/components/ui/separator";
import { useSpotify } from "@/lib/hooks/use-spotify";
import { SpotifyConnectCard } from "@/components/spotify/spotify-connect-card";
import { SpotifySubscriptionList } from "@/components/spotify/spotify-subscription-list";
import { SpotifyDisconnectDialog } from "@/components/spotify/spotify-disconnect-dialog";
import type { Database } from "@/types/database.types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

function SpotifySection() {
  const {
    status,
    isLoadingStatus,
    connect,
    disconnect,
    subscriptions,
    isLoadingSubscriptions,
    isSyncing,
    syncResult,
    syncError,
    sync,
    toggleSubscription,
    setAllEnabled,
  } = useSpotify();

  if (isLoadingStatus) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!status?.connected) {
    return <SpotifyConnectCard onConnect={connect} />;
  }

  return (
    <div className="space-y-4">
      {/* Connected header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Music className="size-5 text-green-500" />
          <div>
            <h3 className="text-base font-medium">Spotify Connected</h3>
            <p className="text-xs text-muted-foreground">
              {status.spotify_display_name ?? status.spotify_user_id}
              {status.last_synced_at && (
                <> &middot; Last synced{" "}
                  {new Date(status.last_synced_at).toLocaleDateString()}
                </>
              )}
            </p>
          </div>
        </div>
        <SpotifyDisconnectDialog onDisconnect={disconnect} />
      </div>

      <SpotifySubscriptionList
        subscriptions={subscriptions}
        loading={isLoadingSubscriptions}
        isSyncing={isSyncing}
        syncResult={syncResult}
        syncError={syncError}
        onSync={sync}
        onToggle={toggleSubscription}
        onSelectAll={() => setAllEnabled(true)}
        onDeselectAll={() => setAllEnabled(false)}
      />
    </div>
  );
}

export default function SettingsPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single<Profile>();
      setProfile(data);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!profile) {
    return <p className="text-muted-foreground">Could not load profile.</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
        <p className="mt-2 text-muted-foreground">
          Configure your account and podcast preferences.
        </p>
      </div>
      <SpotifySection />
      <Separator />
      <PreferencesForm profile={profile} />
    </div>
  );
}
