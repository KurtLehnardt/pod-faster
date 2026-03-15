import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ---------------------------------------------------------------------------
// Mock next/navigation
// ---------------------------------------------------------------------------

const mockPush = vi.fn();
const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
    back: vi.fn(),
    forward: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
  useParams: () => ({}),
  usePathname: () => "/episodes",
}));

// ---------------------------------------------------------------------------
// Mock Supabase client (browser)
// ---------------------------------------------------------------------------

const mockFrom = vi.fn();
const mockGetUser = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: mockGetUser,
    },
    from: mockFrom,
  }),
}));

// ---------------------------------------------------------------------------
// Mock useAudioPlayer (used by EpisodeCard)
// ---------------------------------------------------------------------------

vi.mock("@/lib/hooks/use-audio-player", () => ({
  useAudioPlayer: () => ({
    currentEpisode: null,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 1,
    speed: 1,
    isLoading: false,
    play: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    togglePlayPause: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    setSpeed: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Mock fetch for API calls
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Episode Creation Flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mockFetch);
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-123" } },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("EpisodeConfig Dialog", () => {
    let EpisodeConfig: typeof import("@/components/episodes/episode-config").EpisodeConfig;

    beforeEach(async () => {
      const mod = await import("@/components/episodes/episode-config");
      EpisodeConfig = mod.EpisodeConfig;

      // Mock voices API
      mockFetch.mockImplementation((url: string) => {
        if (typeof url === "string" && url.includes("/api/voices")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                voices: [
                  {
                    voice_id: "voice-1",
                    name: "Alex",
                    category: "premade",
                    preview_url: "https://example.com/alex.mp3",
                  },
                  {
                    voice_id: "voice-2",
                    name: "Jordan",
                    category: "premade",
                    preview_url: "https://example.com/jordan.mp3",
                  },
                ],
              }),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      });
    });

    it("renders dialog when open is true", async () => {
      render(<EpisodeConfig open={true} onOpenChange={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByText("Configure Episode")).toBeDefined();
      });
    });

    it("shows topic input, style selector, tone selector, and length slider", async () => {
      render(<EpisodeConfig open={true} onOpenChange={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByText("Topic")).toBeDefined();
        expect(screen.getByText("Style")).toBeDefined();
        expect(screen.getByText("Tone")).toBeDefined();
        expect(screen.getByText("Length")).toBeDefined();
      });
    });

    it("displays all style options: Monologue, Interview, Group Chat", async () => {
      render(<EpisodeConfig open={true} onOpenChange={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByText("Monologue")).toBeDefined();
        expect(screen.getByText("Interview")).toBeDefined();
        expect(screen.getByText("Group Chat")).toBeDefined();
      });
    });

    it("displays all tone options: Serious, Lighthearted, Dark Mystery, Business News", async () => {
      render(<EpisodeConfig open={true} onOpenChange={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByText("Serious")).toBeDefined();
        expect(screen.getByText("Lighthearted")).toBeDefined();
        expect(screen.getByText("Dark Mystery")).toBeDefined();
        expect(screen.getByText("Business News")).toBeDefined();
      });
    });

    it("uses initial topic when provided", async () => {
      render(
        <EpisodeConfig
          open={true}
          onOpenChange={vi.fn()}
          initialTopic="Artificial Intelligence"
        />
      );

      await waitFor(() => {
        const input = screen.getByPlaceholderText(
          "What should this episode be about?"
        ) as HTMLInputElement;
        expect(input.value).toBe("Artificial Intelligence");
      });
    });

    it("shows voice picker section", async () => {
      render(<EpisodeConfig open={true} onOpenChange={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByText("Voices")).toBeDefined();
      });
    });

    it("Generate Episode button is disabled without topic and voices", async () => {
      render(<EpisodeConfig open={true} onOpenChange={vi.fn()} />);

      await waitFor(() => {
        const btn = screen.getByText("Generate Episode")
          .closest("button") as HTMLButtonElement;
        expect(btn?.disabled).toBe(true);
      });
    });

    it("shows dialog description text", async () => {
      render(<EpisodeConfig open={true} onOpenChange={vi.fn()} />);

      await waitFor(() => {
        expect(
          screen.getByText(
            "Set up your podcast episode parameters and choose voices."
          )
        ).toBeDefined();
      });
    });
  });

  describe("Episode creation API contract", () => {
    it("POST /api/episodes creates an episode with correct payload", async () => {
      const payload = {
        topicQuery: "Quantum Computing",
        style: "interview",
        tone: "serious",
        lengthMinutes: 10,
        voiceConfig: {
          voices: [
            { role: "host", voice_id: "v1", name: "Alex" },
            { role: "expert", voice_id: "v2", name: "Jordan" },
          ],
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: () =>
          Promise.resolve({
            episode: {
              id: "ep-1",
              user_id: "user-123",
              status: "pending",
              ...payload,
            },
          }),
      });

      const res = await fetch("/api/episodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.episode.id).toBe("ep-1");
      expect(data.episode.status).toBe("pending");
    });

    it("POST /api/generate starts the pipeline for an episode", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            started: true,
            episodeId: "ep-1",
            status: "searching",
          }),
      });

      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ episodeId: "ep-1" }),
      });

      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.started).toBe(true);
      expect(data.episodeId).toBe("ep-1");
      expect(data.status).toBe("searching");
    });
  });

  describe("Generation Progress", () => {
    let GenerationProgress: typeof import("@/components/episodes/generation-progress").GenerationProgress;

    beforeEach(async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const mod = await import("@/components/episodes/generation-progress");
      GenerationProgress = mod.GenerationProgress;
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("renders null when episodeId is null", () => {
      const { container } = render(
        <GenerationProgress episodeId={null} />
      );
      expect(container.innerHTML).toBe("");
    });

    it("shows loading state initially", async () => {
      mockFetch.mockImplementation(() =>
        new Promise(() => {
          /* never resolves */
        })
      );

      render(<GenerationProgress episodeId="ep-1" />);

      expect(screen.getByText("Loading episode status...")).toBeDefined();
    });

    it("displays pipeline step labels", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            episode: {
              id: "ep-1",
              status: "summarizing",
              topic_query: "test",
              style: "monologue",
              tone: "serious",
              length_minutes: 5,
              created_at: new Date().toISOString(),
            },
          }),
      });

      render(<GenerationProgress episodeId="ep-1" />);

      await waitFor(() => {
        expect(screen.getByText("Searching")).toBeDefined();
        expect(screen.getByText("Summarizing")).toBeDefined();
        expect(screen.getByText("Writing Script")).toBeDefined();
        expect(screen.getByText("Generating Audio")).toBeDefined();
        expect(screen.getByText("Uploading")).toBeDefined();
        expect(screen.getByText("Complete")).toBeDefined();
      });
    });

    it("shows error state for failed episodes", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            episode: {
              id: "ep-1",
              status: "failed",
              error_message: "Anthropic API timeout",
              topic_query: "test",
              style: "monologue",
              tone: "serious",
              length_minutes: 5,
              created_at: new Date().toISOString(),
            },
          }),
      });

      render(<GenerationProgress episodeId="ep-1" onClose={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByText("Generation failed")).toBeDefined();
        expect(screen.getByText("Anthropic API timeout")).toBeDefined();
        expect(screen.getByText("Close")).toBeDefined();
      });
    });

    it("shows success state for completed episodes", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            episode: {
              id: "ep-1",
              status: "completed",
              topic_query: "test",
              style: "monologue",
              tone: "serious",
              length_minutes: 5,
              created_at: new Date().toISOString(),
            },
          }),
      });

      render(<GenerationProgress episodeId="ep-1" onClose={vi.fn()} />);

      await waitFor(() => {
        expect(
          screen.getByText("Episode generated successfully!")
        ).toBeDefined();
        expect(screen.getByText("Done")).toBeDefined();
      });
    });

    it("calls onClose when Done button is clicked", async () => {
      const onClose = vi.fn();
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            episode: {
              id: "ep-1",
              status: "completed",
              topic_query: "test",
              style: "monologue",
              tone: "serious",
              length_minutes: 5,
              created_at: new Date().toISOString(),
            },
          }),
      });

      render(<GenerationProgress episodeId="ep-1" onClose={onClose} />);

      await waitFor(() => {
        expect(screen.getByText("Done")).toBeDefined();
      });

      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await user.click(screen.getByText("Done"));

      expect(onClose).toHaveBeenCalled();
    });
  });

  describe("Episodes Page", () => {
    let EpisodesPage: React.ComponentType;

    beforeEach(async () => {
      const mod = await import("@/app/(app)/episodes/page");
      EpisodesPage = mod.default;
    });

    it("shows empty state when no episodes exist", async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          }),
        }),
      });

      render(<EpisodesPage />);

      await waitFor(() => {
        expect(screen.getByText("No episodes yet")).toBeDefined();
      });
    });

    it("displays episode cards when episodes exist", async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: [
                {
                  id: "ep-1",
                  title: "AI Trends 2026",
                  topic_query: "AI trends",
                  status: "completed" as const,
                  style: "monologue" as const,
                  tone: "serious" as const,
                  length_minutes: 5,
                  audio_duration_seconds: 300,
                  created_at: "2026-03-15T10:00:00Z",
                },
              ],
              error: null,
            }),
          }),
        }),
      });

      render(<EpisodesPage />);

      await waitFor(() => {
        expect(screen.getByText("AI Trends 2026")).toBeDefined();
      });
    });

    it("shows New Episode button", async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          }),
        }),
      });

      render(<EpisodesPage />);

      await waitFor(() => {
        expect(screen.getByText("New Episode")).toBeDefined();
      });
    });

    it("shows filter tabs: All, Completed, In Progress, Failed", async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          }),
        }),
      });

      render(<EpisodesPage />);

      await waitFor(() => {
        expect(screen.getByText("All")).toBeDefined();
        expect(screen.getByText("Completed")).toBeDefined();
        expect(screen.getByText("In Progress")).toBeDefined();
        expect(screen.getByText("Failed")).toBeDefined();
      });
    });
  });
});
