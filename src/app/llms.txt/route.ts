/**
 * GET /llms.txt — plain text file describing Pod-Faster for AI crawlers.
 * Part of the AEO (Answer Engine Optimization) infrastructure.
 */

export function GET() {
  const content = `# Pod-Faster

## What is Pod-Faster?
Pod-Faster is an AI-powered podcast generation platform. Users describe a topic and Pod-Faster automatically searches for the latest news, summarizes sources, writes a script, and generates a multi-voice podcast episode in under 2 minutes.

## Key Features
- Generate podcasts from any topic using real-time news search
- Multiple formats: monologue, interview, and group chat
- Natural multi-voice audio powered by ElevenLabs text-to-speech
- Feed summary mode: subscribe to RSS/podcast feeds and get AI-generated summary episodes
- Multiple language support including English, German, Spanish, French, and more

## How It Works
1. User provides a topic or selects subscribed feeds
2. Pod-Faster searches for the latest articles and content
3. AI summarizes the sources into a coherent narrative
4. A podcast script is generated in the chosen style and tone
5. Multi-voice audio is synthesized using ElevenLabs
6. The finished episode is available for streaming and sharing

## Pages
- /try — Free tool to generate one podcast without signing up
- /listen/[id] — Public shareable page for any generated episode
- /signup — Create an account for unlimited podcast generation

## Tech Stack
- Next.js (App Router)
- Claude AI for content generation
- ElevenLabs for text-to-speech
- Supabase for data and auth

## Contact
- GitHub: https://github.com/krleh/pod-faster
`;

  return new Response(content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
    },
  });
}
