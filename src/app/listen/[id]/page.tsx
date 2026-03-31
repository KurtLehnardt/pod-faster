import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { ListenPageClient } from "./listen-client";

interface Props {
  params: Promise<{ id: string }>;
}

async function getEpisode(id: string) {
  const supabase = await createClient();

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
      type: "music.song",
      ...(episode.audioUrl ? { audio: episode.audioUrl } : {}),
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
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
        <h1 className="text-4xl font-bold">404</h1>
        <p className="mt-2 text-lg text-muted-foreground">
          This episode doesn't exist or isn't available yet.
        </p>
        <a
          href="/try"
          className="mt-6 text-sm text-violet-400 underline underline-offset-4 hover:text-violet-300"
        >
          Make your own podcast
        </a>
      </div>
    );
  }

  return <ListenPageClient episode={episode} />;
}
