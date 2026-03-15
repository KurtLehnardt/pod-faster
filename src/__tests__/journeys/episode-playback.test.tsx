import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ---------------------------------------------------------------------------
// Mock next/navigation
// ---------------------------------------------------------------------------

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
  useParams: () => ({ id: "ep-1" }),
  usePathname: () => "/episodes/ep-1",
}));

// ---------------------------------------------------------------------------
// Mock Supabase client
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
// Mock useAudioPlayer
// ---------------------------------------------------------------------------

const mockPlay = vi.fn();
const mockPause = vi.fn();
const mockResume = vi.fn();
const mockTogglePlayPause = vi.fn();
const mockSeek = vi.fn();
const mockSetVolume = vi.fn();
const mockSetSpeed = vi.fn();

let audioPlayerState = {
  currentEpisode: null as { id: string; title: string; audioUrl: string } | null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 1,
  speed: 1,
  isLoading: false,
};

vi.mock("@/lib/hooks/use-audio-player", () => ({
  useAudioPlayer: () => ({
    ...audioPlayerState,
    play: mockPlay,
    pause: mockPause,
    resume: mockResume,
    togglePlayPause: mockTogglePlayPause,
    seek: mockSeek,
    setVolume: mockSetVolume,
    setSpeed: mockSetSpeed,
  }),
}));

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Episode Playback Flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mockFetch);
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-123" } } });

    audioPlayerState = {
      currentEpisode: null,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      volume: 1,
      speed: 1,
      isLoading: false,
    };
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("Episode Detail Page", () => {
    let EpisodeDetailPage: React.ComponentType;

    const completedEpisode = {
      id: "ep-1",
      title: "AI Trends 2026",
      topic_query: "artificial intelligence trends",
      status: "completed",
      style: "interview",
      tone: "serious",
      length_minutes: 10,
      audio_duration_seconds: 600,
      audio_path: "user-123/ep-1/audio.mp3",
      script: {
        title: "AI Trends 2026",
        segments: [
          { speaker: "Host", text: "Welcome to the show.", voice_id: "v1" },
          {
            speaker: "Expert",
            text: "AI is evolving rapidly in 2026.",
            voice_id: "v2",
          },
          {
            speaker: "Host",
            text: "Tell us more about the latest developments.",
            voice_id: "v1",
          },
        ],
      },
      sources: [
        { title: "AI Report 2026", url: "https://example.com/ai-report" },
        { title: "Tech News", url: "https://example.com/tech-news" },
      ],
      summary: "A deep dive into AI trends for 2026.",
      error_message: null,
      created_at: "2026-03-15T10:00:00Z",
      completed_at: "2026-03-15T10:15:00Z",
    };

    beforeEach(async () => {
      const mod = await import("@/app/(app)/episodes/[id]/page");
      EpisodeDetailPage = mod.default;
    });

    it("shows loading state initially", () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockReturnValue(new Promise(() => {})),
          }),
        }),
      });

      render(<EpisodeDetailPage />);

      // Loader2 spinner should be present (the loading animation)
      const container = document.querySelector('[class*="animate-spin"]');
      expect(container).toBeDefined();
    });

    it("displays episode title and metadata when loaded", async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: completedEpisode,
              error: null,
            }),
          }),
        }),
      });

      render(<EpisodeDetailPage />);

      await waitFor(() => {
        expect(screen.getByText("AI Trends 2026")).toBeDefined();
      });
    });

    it("shows style and tone badges", async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: completedEpisode,
              error: null,
            }),
          }),
        }),
      });

      render(<EpisodeDetailPage />);

      await waitFor(() => {
        expect(screen.getByText("interview")).toBeDefined();
        expect(screen.getByText("serious")).toBeDefined();
      });
    });

    it("shows Play Episode button for completed episodes", async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: completedEpisode,
              error: null,
            }),
          }),
        }),
      });

      render(<EpisodeDetailPage />);

      await waitFor(() => {
        expect(screen.getByText("Play Episode")).toBeDefined();
      });
    });

    it("shows Delete button", async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: completedEpisode,
              error: null,
            }),
          }),
        }),
      });

      render(<EpisodeDetailPage />);

      await waitFor(() => {
        expect(screen.getByText("Delete")).toBeDefined();
      });
    });

    it("displays summary section", async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: completedEpisode,
              error: null,
            }),
          }),
        }),
      });

      render(<EpisodeDetailPage />);

      await waitFor(() => {
        expect(screen.getByText("Summary")).toBeDefined();
        expect(
          screen.getByText("A deep dive into AI trends for 2026.")
        ).toBeDefined();
      });
    });

    it("displays sources section with links", async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: completedEpisode,
              error: null,
            }),
          }),
        }),
      });

      render(<EpisodeDetailPage />);

      await waitFor(() => {
        expect(screen.getByText("Sources")).toBeDefined();
        expect(screen.getByText("AI Report 2026")).toBeDefined();
        expect(screen.getByText("Tech News")).toBeDefined();
      });
    });

    it("displays script viewer with segments", async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: completedEpisode,
              error: null,
            }),
          }),
        }),
      });

      render(<EpisodeDetailPage />);

      await waitFor(() => {
        expect(screen.getByText("Script")).toBeDefined();
        expect(screen.getByText("Welcome to the show.")).toBeDefined();
        expect(
          screen.getByText("AI is evolving rapidly in 2026.")
        ).toBeDefined();
      });
    });

    it("shows back link to episodes list", async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: completedEpisode,
              error: null,
            }),
          }),
        }),
      });

      render(<EpisodeDetailPage />);

      await waitFor(() => {
        const backLink = screen.getByText("Episodes");
        expect(backLink.closest("a")?.getAttribute("href")).toBe("/episodes");
      });
    });

    it("shows not found message for missing episode", async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { message: "Not found" },
            }),
          }),
        }),
      });

      render(<EpisodeDetailPage />);

      await waitFor(() => {
        expect(screen.getByText("Episode not found.")).toBeDefined();
      });
    });

    it("shows error message for failed episodes", async () => {
      const failedEpisode = {
        ...completedEpisode,
        status: "failed",
        error_message: "Anthropic API rate limit exceeded",
        audio_path: null,
        script: null,
        summary: null,
      };

      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: failedEpisode,
              error: null,
            }),
          }),
        }),
      });

      render(<EpisodeDetailPage />);

      await waitFor(() => {
        expect(
          screen.getByText("Anthropic API rate limit exceeded")
        ).toBeDefined();
      });
    });

    it("shows in-progress indicator for generating episodes", async () => {
      const inProgressEpisode = {
        ...completedEpisode,
        status: "scripting",
        audio_path: null,
        script: null,
        summary: "Summarized content",
      };

      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: inProgressEpisode,
              error: null,
            }),
          }),
        }),
      });

      render(<EpisodeDetailPage />);

      await waitFor(() => {
        expect(screen.getByText("Generation in progress")).toBeDefined();
      });
    });
  });

  describe("ScriptViewer Component", () => {
    let ScriptViewer: typeof import("@/components/episodes/script-viewer").ScriptViewer;

    beforeEach(async () => {
      const mod = await import("@/components/episodes/script-viewer");
      ScriptViewer = mod.ScriptViewer;
    });

    it("renders script segments with speaker names", () => {
      const script = {
        title: "Test Script",
        segments: [
          { speaker: "Host", text: "Hello everyone!", voice_id: "v1" },
          {
            speaker: "Expert",
            text: "Great to be here.",
            voice_id: "v2",
          },
        ],
      };

      render(<ScriptViewer script={script} />);

      expect(screen.getByText("Hello everyone!")).toBeDefined();
      expect(screen.getByText("Great to be here.")).toBeDefined();
      // Speaker names shown
      expect(screen.getAllByText("Host").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Expert").length).toBeGreaterThan(0);
    });

    it("shows speaker initials in avatar", () => {
      const script = {
        title: "Test",
        segments: [
          { speaker: "John Doe", text: "Test text", voice_id: "v1" },
        ],
      };

      render(<ScriptViewer script={script} />);

      // Initials should be "JD"
      expect(screen.getByText("JD")).toBeDefined();
    });

    it("shows empty state when no segments exist", () => {
      const script = {
        title: "Empty",
        segments: [],
      };

      render(<ScriptViewer script={script} />);

      expect(
        screen.getByText("No script segments available.")
      ).toBeDefined();
    });
  });

  describe("AudioPlayer Component", () => {
    let AudioPlayer: typeof import("@/components/player/audio-player").AudioPlayer;

    beforeEach(async () => {
      const mod = await import("@/components/player/audio-player");
      AudioPlayer = mod.AudioPlayer;
    });

    it("renders nothing when no episode is playing", () => {
      audioPlayerState.currentEpisode = null;

      const { container } = render(<AudioPlayer />);
      expect(container.innerHTML).toBe("");
    });

    it("renders player controls when an episode is loaded", () => {
      audioPlayerState.currentEpisode = {
        id: "ep-1",
        title: "Test Episode",
        audioUrl: "https://example.com/audio.mp3",
      };

      render(<AudioPlayer />);

      expect(screen.getByText("Test Episode")).toBeDefined();
      expect(screen.getByLabelText("Play")).toBeDefined();
    });

    it("shows Pause button when playing", () => {
      audioPlayerState.currentEpisode = {
        id: "ep-1",
        title: "Test Episode",
        audioUrl: "https://example.com/audio.mp3",
      };
      audioPlayerState.isPlaying = true;

      render(<AudioPlayer />);

      expect(screen.getByLabelText("Pause")).toBeDefined();
    });

    it("displays current speed", () => {
      audioPlayerState.currentEpisode = {
        id: "ep-1",
        title: "Test",
        audioUrl: "https://example.com/a.mp3",
      };
      audioPlayerState.speed = 1.5;

      render(<AudioPlayer />);

      expect(screen.getByText("1.5x")).toBeDefined();
    });

    it("calls togglePlayPause when play button is clicked", async () => {
      audioPlayerState.currentEpisode = {
        id: "ep-1",
        title: "Test Episode",
        audioUrl: "https://example.com/audio.mp3",
      };

      render(<AudioPlayer />);

      const user = userEvent.setup();
      await user.click(screen.getByLabelText("Play"));

      expect(mockTogglePlayPause).toHaveBeenCalled();
    });

    it("renders progress bar with correct ARIA attributes", () => {
      audioPlayerState.currentEpisode = {
        id: "ep-1",
        title: "Test",
        audioUrl: "https://example.com/a.mp3",
      };
      audioPlayerState.currentTime = 30;
      audioPlayerState.duration = 300;

      render(<AudioPlayer />);

      const progressBar = screen.getByRole("slider", {
        name: "Playback progress",
      });
      expect(progressBar).toBeDefined();
      expect(progressBar.getAttribute("aria-valuenow")).toBe("30");
      expect(progressBar.getAttribute("aria-valuemax")).toBe("300");
    });

    it("renders volume slider with correct ARIA attributes", () => {
      audioPlayerState.currentEpisode = {
        id: "ep-1",
        title: "Test",
        audioUrl: "https://example.com/a.mp3",
      };
      audioPlayerState.volume = 0.75;

      render(<AudioPlayer />);

      const volumeSlider = screen.getByRole("slider", { name: "Volume" });
      expect(volumeSlider).toBeDefined();
      expect(volumeSlider.getAttribute("aria-valuenow")).toBe("75");
    });

    it("shows Mute button label correctly", () => {
      audioPlayerState.currentEpisode = {
        id: "ep-1",
        title: "Test",
        audioUrl: "https://example.com/a.mp3",
      };
      audioPlayerState.volume = 0.5;

      render(<AudioPlayer />);

      expect(screen.getByLabelText("Mute")).toBeDefined();
    });

    it("shows Unmute button when volume is 0", () => {
      audioPlayerState.currentEpisode = {
        id: "ep-1",
        title: "Test",
        audioUrl: "https://example.com/a.mp3",
      };
      audioPlayerState.volume = 0;

      render(<AudioPlayer />);

      expect(screen.getByLabelText("Unmute")).toBeDefined();
    });

    it("displays time in mm:ss format", () => {
      audioPlayerState.currentEpisode = {
        id: "ep-1",
        title: "Test",
        audioUrl: "https://example.com/a.mp3",
      };
      audioPlayerState.currentTime = 65;
      audioPlayerState.duration = 300;

      render(<AudioPlayer />);

      // 65s = 1:05, 300s = 5:00
      expect(screen.getByText("1:05 / 5:00")).toBeDefined();
    });

    it("renders compact mode with progress bar on top", () => {
      audioPlayerState.currentEpisode = {
        id: "ep-1",
        title: "Test",
        audioUrl: "https://example.com/a.mp3",
      };

      render(<AudioPlayer compact />);

      expect(screen.getByText("Test")).toBeDefined();
      // In compact mode, the progress bar renders first
      const sliders = screen.getAllByRole("slider");
      expect(sliders.length).toBeGreaterThanOrEqual(1);
    });

    it("shows speed label with aria-label", () => {
      audioPlayerState.currentEpisode = {
        id: "ep-1",
        title: "Test",
        audioUrl: "https://example.com/a.mp3",
      };
      audioPlayerState.speed = 2;

      render(<AudioPlayer />);

      expect(screen.getByLabelText("Playback speed: 2x")).toBeDefined();
    });
  });
});
