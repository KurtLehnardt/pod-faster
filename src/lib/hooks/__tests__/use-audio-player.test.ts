import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// We need to reset module state between tests since useAudioPlayer uses
// module-level singleton state. We use dynamic import via vi.importActual
// and resetModules to get fresh state.

describe("useAudioPlayer", () => {
  let useAudioPlayer: typeof import("../../hooks/use-audio-player").useAudioPlayer;

  // Mock HTMLAudioElement since jsdom's Audio is minimal
  let audioMock: {
    src: string;
    volume: number;
    playbackRate: number;
    currentTime: number;
    duration: number;
    paused: boolean;
    preload: string;
    play: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
  };

  const eventHandlers: Map<string, (() => void)[]> = new Map();

  beforeEach(async () => {
    vi.resetModules();
    eventHandlers.clear();

    audioMock = {
      src: "",
      volume: 1,
      playbackRate: 1,
      currentTime: 0,
      duration: 0,
      paused: true,
      preload: "",
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      addEventListener: vi.fn((event: string, handler: () => void) => {
        const handlers = eventHandlers.get(event) || [];
        handlers.push(handler);
        eventHandlers.set(event, handlers);
      }),
      removeEventListener: vi.fn(),
    };

    // Replace global Audio constructor — must be a real function for `new`.
    // Returning an object from a constructor function overrides `this`.
    vi.stubGlobal(
      "Audio",
      function AudioMock() {
        return audioMock;
      } as unknown as typeof Audio,
    );

    // Mock localStorage
    const store: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key];
      }),
    });

    // Mock requestAnimationFrame / cancelAnimationFrame
    vi.stubGlobal("requestAnimationFrame", vi.fn((cb: () => void) => {
      return 1;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    // Fresh import to reset module singleton state
    const mod = await import("../../hooks/use-audio-player");
    useAudioPlayer = mod.useAudioPlayer;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function triggerAudioEvent(event: string) {
    const handlers = eventHandlers.get(event) || [];
    for (const handler of handlers) {
      handler();
    }
  }

  it("returns initial state", () => {
    const { result } = renderHook(() => useAudioPlayer());

    expect(result.current.currentEpisode).toBeNull();
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.currentTime).toBe(0);
    expect(result.current.duration).toBe(0);
    expect(result.current.isLoading).toBe(false);
  });

  it("exposes control functions", () => {
    const { result } = renderHook(() => useAudioPlayer());

    expect(typeof result.current.play).toBe("function");
    expect(typeof result.current.pause).toBe("function");
    expect(typeof result.current.resume).toBe("function");
    expect(typeof result.current.togglePlayPause).toBe("function");
    expect(typeof result.current.seek).toBe("function");
    expect(typeof result.current.setVolume).toBe("function");
    expect(typeof result.current.setSpeed).toBe("function");
  });

  it("sets loading state when playing a new episode", () => {
    const { result } = renderHook(() => useAudioPlayer());

    act(() => {
      result.current.play({
        id: "ep-1",
        title: "Test Episode",
        audioUrl: "https://example.com/audio.mp3",
      });
    });

    expect(result.current.currentEpisode?.id).toBe("ep-1");
    expect(result.current.isLoading).toBe(true);
    expect(audioMock.src).toBe("https://example.com/audio.mp3");
    expect(audioMock.play).toHaveBeenCalled();
  });

  it("updates isPlaying when the playing event fires", () => {
    const { result } = renderHook(() => useAudioPlayer());

    act(() => {
      result.current.play({
        id: "ep-1",
        title: "Test",
        audioUrl: "https://example.com/a.mp3",
      });
    });

    act(() => {
      triggerAudioEvent("playing");
    });

    expect(result.current.isPlaying).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });

  it("updates isPlaying to false when pause event fires", () => {
    const { result } = renderHook(() => useAudioPlayer());

    act(() => {
      result.current.play({
        id: "ep-1",
        title: "Test",
        audioUrl: "https://example.com/a.mp3",
      });
    });

    act(() => {
      triggerAudioEvent("playing");
    });

    act(() => {
      result.current.pause();
    });

    act(() => {
      triggerAudioEvent("pause");
    });

    expect(result.current.isPlaying).toBe(false);
  });

  it("sets volume and clamps to 0-1 range", () => {
    const { result } = renderHook(() => useAudioPlayer());

    act(() => {
      // Need to trigger a play to initialize the audio element
      result.current.play({
        id: "ep-1",
        title: "Test",
        audioUrl: "https://example.com/a.mp3",
      });
    });

    act(() => {
      result.current.setVolume(0.5);
    });
    expect(result.current.volume).toBe(0.5);

    act(() => {
      result.current.setVolume(2);
    });
    expect(result.current.volume).toBe(1);

    act(() => {
      result.current.setVolume(-1);
    });
    expect(result.current.volume).toBe(0);
  });

  it("sets playback speed", () => {
    const { result } = renderHook(() => useAudioPlayer());

    act(() => {
      result.current.play({
        id: "ep-1",
        title: "Test",
        audioUrl: "https://example.com/a.mp3",
      });
    });

    act(() => {
      result.current.setSpeed(1.5);
    });

    expect(result.current.speed).toBe(1.5);
    expect(audioMock.playbackRate).toBe(1.5);
  });

  it("resets state when audio ends", () => {
    const { result } = renderHook(() => useAudioPlayer());

    act(() => {
      result.current.play({
        id: "ep-1",
        title: "Test",
        audioUrl: "https://example.com/a.mp3",
      });
    });

    act(() => {
      triggerAudioEvent("playing");
    });

    act(() => {
      triggerAudioEvent("ended");
    });

    expect(result.current.isPlaying).toBe(false);
    expect(result.current.currentTime).toBe(0);
  });

  it("handles error event gracefully", () => {
    const { result } = renderHook(() => useAudioPlayer());

    act(() => {
      result.current.play({
        id: "ep-1",
        title: "Test",
        audioUrl: "https://example.com/a.mp3",
      });
    });

    act(() => {
      triggerAudioEvent("error");
    });

    expect(result.current.isPlaying).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });
});
