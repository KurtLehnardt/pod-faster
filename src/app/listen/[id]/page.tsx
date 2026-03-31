import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { ListenPageClient } from "./listen-client";

interface Props {
  params: Promise<{ id: string }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getEpisode(id: string) {
  if (!UUID_RE.test(id)) return null;

  const supabase = createAdminClient();

  const { data: episode, error } = await supabase
    .from("episodes")
    .select(
      "id, title, topic_query, style, tone, status, audio_path, script, created_at"
    )
    .eq("id", id)
    .eq("status", "completed")
    .single();

  if (error || !episode) return null;

  // Generate a signed URL for the audio if it has an audio_path
  let audioUrl: string | null = null;
  if (episode.audio_path) {
    const { data: signedData } = await supabase.storage
      .from("audio")
      .createSignedUrl(episode.audio_path, 60 * 60); // 1 hour
    audioUrl = signedData?.signedUrl ?? null;
  }

  return { ...episode, audioUrl };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const episode = await getEpisode(id);

  if (!episode) {
    return { title: "Episode Not Found — Pod-Faster" };
  }

  const title = episode.title || `Podcast about ${episode.topic_query}`;
  const description = `Listen to an AI-generated ${episode.style} podcast about ${episode.topic_query}. Created with Pod-Faster.`;

  return {
    title: `${title} — Pod-Faster`,
    description,
    openGraph: {
      title,
      description,
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function ListenPage({ params }: Props) {
  const { id } = await params;
  const episode = await getEpisode(id);

  if (!episode) {
    notFound();
  }

  return <ListenPageClient episode={episode} />;
}
