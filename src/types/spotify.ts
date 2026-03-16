/**
 * TypeScript types for the Spotify Web API integration.
 */

// -- Spotify API response types --

export interface SpotifyImage {
  url: string;
  height: number | null;
  width: number | null;
}

export interface SpotifyShow {
  id: string;
  name: string;
  publisher: string;
  description: string;
  images: SpotifyImage[];
  external_urls: { spotify: string };
  total_episodes: number;
}

export interface SpotifySavedShowItem {
  added_at: string;
  show: SpotifyShow;
}

export interface SpotifyPaginatedResponse<T> {
  href: string;
  items: T[];
  limit: number;
  next: string | null;
  offset: number;
  previous: string | null;
  total: number;
}

export interface SpotifyTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  expires_in: number;
  refresh_token?: string;
}

export interface SpotifyUserProfile {
  id: string;
  display_name: string | null;
  email: string | null;
  images: { url: string }[];
}

// -- Internal types --

export interface SpotifyTokens {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  spotify_user_id: string;
  spotify_display_name: string | null;
}

export interface SpotifySubscription {
  id: string;
  user_id: string;
  spotify_show_id: string;
  show_name: string;
  publisher: string;
  description: string;
  image_url: string | null;
  spotify_url: string;
  total_episodes: number;
  summarization_enabled: boolean;
  is_removed: boolean;
  synced_at: string;
  created_at: string;
  updated_at: string;
}

export type SpotifyConnectionStatus =
  | { connected: false }
  | {
      connected: true;
      spotify_user_id: string;
      spotify_display_name: string | null;
      last_synced_at: string | null;
      subscription_count: number;
    };

export interface SyncResult {
  added: number;
  removed: number;
  unchanged: number;
  total: number;
}
