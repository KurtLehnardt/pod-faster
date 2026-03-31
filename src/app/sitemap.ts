import type { MetadataRoute } from "next";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://pod-faster.com";

  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${baseUrl}/try`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${baseUrl}/signup`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${baseUrl}/login`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.5,
    },
  ];

  // Dynamic listen pages — fetch completed episodes
  let episodePages: MetadataRoute.Sitemap = [];
  try {
    const supabase = createAdminClient();
    const { data: episodes } = await supabase
      .from("episodes")
      .select("id, created_at")
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(500);

    if (episodes) {
      episodePages = episodes.map((ep) => ({
        url: `${baseUrl}/listen/${ep.id}`,
        lastModified: new Date(ep.created_at),
        changeFrequency: "monthly" as const,
        priority: 0.6,
      }));
    }
  } catch {
    // Sitemap should still work if DB is unreachable
  }

  return [...staticPages, ...episodePages];
}
