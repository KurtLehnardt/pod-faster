/**
 * GET /robots.txt — dynamic robots.txt allowing AI and search engine bots.
 * Part of the AEO (Answer Engine Optimization) infrastructure.
 */

export function GET() {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://pod-faster.com";

  const content = `# Pod-Faster robots.txt
# Welcome, bots!

User-agent: *
Allow: /

# Explicitly allow AI crawlers
User-agent: GPTBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Googlebot
Allow: /

User-agent: Bingbot
Allow: /

# Disallow private/auth routes
User-agent: *
Disallow: /api/
Disallow: /(app)/
Disallow: /(auth)/

# Sitemaps
Sitemap: ${baseUrl}/sitemap.xml

# LLMs.txt
# See: ${baseUrl}/llms.txt
`;

  return new Response(content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
    },
  });
}
