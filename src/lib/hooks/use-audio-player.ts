"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AudioEpisode {
  id: string;
  title: string;
  audioUrl: string;
}

export interface AudioPlayerState {
  currentEpisode: AudioEpisode | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  speed: number;
  isLoading: boolean;
}

type Listener = () => void;

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

const STORAGE_KEY_VOLUME = "pf-player-volume";
const STORAGE_KEY_SPEED = "pf-player-speed";
const STORAGE_KEY_POSITION = "pf-player-position";

function loadNumber(key: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

function saveNumber(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* quota errors are non-fatal */
  }
}

function loadPosition(episodeId: string): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_POSITION);
    if (!raw) return 0;
    const map: Record<string, number> = JSON.parse(raw);
    return map[episodeId] ?? 0;
  } catch {
    return 0;
  }
}

function savePosition(episodeId: string, time: number): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_POSITION);
    const map: Record<string, number> = raw ? JSON.parse(raw) : {};
    map[episodeId] = time;
    // Keep at most 50 entries
    const keys = Object.keys(map);
    if (keys.length > 50) {
      delete map[keys[0]];
    }
    localStorage.setItem(STORAGE_KEY_POSITION, JSON.stringify(map));
  } catch {
    /* non-fatal */
  }
}

// ---------------------------------------------------------------------------
// Singleton store (module-level, shared by all components)
// ---------------------------------------------------------------------------

let state: AudioPlayerState = {
  currentEpisode: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 1,
  speed: 1,
  isLoading: false,
};

const listeners = new Set<Listener>();
let audioElement: HTMLAudioElement | null = null;
let rafId: number | null = null;
let initialized = false;

function getState(): AudioPlayerState {
  return state;
}

function emit(): void {
  listeners.forEach((l) => l());
}

function setState(patch: Partial<AudioPlayerState>): void {
  state = { ...state, ...patch };
  emit();
}

function getAudio(): HTMLAudioElement {
  if (!audioElement) {
    audioElement = new Audio();
    audioElement.preload = "metadata";
  }
  return audioElement;
}

function startRAF(): void {
  if (rafId !== null) return;
  const tick = () => {
    const audio = getAudio();
    if (audio && !audio.paused) {
      const patch: Partial<AudioPlayerState> = { currentTime: audio.currentTime };
      if (Number.isFinite(audio.duration) && audio.duration > state.duration) {
        patch.duration = audio.duration;
      }
      setState(patch);
    }
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
}

function stopRAF(): void {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

function initAudioListeners(): void {
  if (initialized) return;
  initialized = true;

  const audio = getAudio();

  audio.addEventListener("loadedmetadata", () => {
    setState({ duration: audio.duration, isLoading: false });
  });

  audio.addEventListener("durationchange", () => {
    if (Number.isFinite(audio.duration)) {
      setState({ duration: audio.duration });
    }
  });

  audio.addEventListener("canplay", () => {
    setState({ isLoading: false });
  });

  audio.addEventListener("waiting", () => {
    setState({ isLoading: true });
  });

  audio.addEventListener("playing", () => {
    setState({ isPlaying: true, isLoading: false });
    startRAF();
  });

  audio.addEventListener("pause", () => {
    setState({ isPlaying: false });
    stopRAF();
    // Persist position on pause
    if (state.currentEpisode) {
      savePosition(state.currentEpisode.id, audio.currentTime);
    }
  });

  audio.addEventListener("ended", () => {
    setState({ isPlaying: false, currentTime: 0 });
    stopRAF();
    if (state.currentEpisode) {
      savePosition(state.currentEpisode.id, 0);
    }
  });

  audio.addEventListener("error", () => {
    setState({ isPlaying: false, isLoading: false });
    stopRAF();
  });

  audio.addEventListener("timeupdate", () => {
    // Backup for when rAF is not running
    if (rafId === null) {
      setState({ currentTime: audio.currentTime });
    }
  });
}

// ---------------------------------------------------------------------------
// Actions (plain functions, not hooks)
// ---------------------------------------------------------------------------

function play(episode: AudioEpisode): void {
  const audio = getAudio();
  initAudioListeners();

  const isSameEpisode = state.currentEpisode?.id === episode.id;

  if (isSameEpisode && audio.src) {
    // Resume
    audio.play().catch(() => {});
    return;
  }

  // Load new episode
  setState({
    currentEpisode: episode,
    isLoading: true,
    currentTime: 0,
    duration: 0,
  });

  audio.src = episode.audioUrl;
  audio.volume = state.volume;
  audio.playbackRate = state.speed;

  // Restore saved position
  const savedPos = loadPosition(episode.id);
  if (savedPos > 0) {
    audio.currentTime = savedPos;
    setState({ currentTime: savedPos });
  }

  audio.play().catch(() => {
    setState({ isLoading: false });
  });
}

function pause(): void {
  const audio = getAudio();
  audio.pause();
}

function resume(): void {
  const audio = getAudio();
  if (audio.src) {
    audio.play().catch(() => {});
  }
}

function togglePlayPause(): void {
  if (state.isPlaying) {
    pause();
  } else {
    resume();
  }
}

function seek(time: number): void {
  const audio = getAudio();
  if (!audio.src) return;
  const clamped = Math.max(0, Math.min(time, audio.duration || Infinity));
  audio.currentTime = clamped;
  setState({ currentTime: clamped });
  if (state.currentEpisode) {
    savePosition(state.currentEpisode.id, clamped);
  }
}

function setVolume(vol: number): void {
  const audio = getAudio();
  const clamped = Math.max(0, Math.min(1, vol));
  audio.volume = clamped;
  setState({ volume: clamped });
  saveNumber(STORAGE_KEY_VOLUME, clamped);
}

function setSpeed(speed: number): void {
  const audio = getAudio();
  audio.playbackRate = speed;
  setState({ speed });
  saveNumber(STORAGE_KEY_SPEED, speed);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAudioPlayer() {
  const subscribe = useCallback((listener: Listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const playerState = useSyncExternalStore(subscribe, getState, getState);

  // Hydrate volume/speed from localStorage on first mount
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;

    const savedVolume = loadNumber(STORAGE_KEY_VOLUME, 1);
    const savedSpeed = loadNumber(STORAGE_KEY_SPEED, 1);
    setState({ volume: savedVolume, speed: savedSpeed });

    const audio = getAudio();
    audio.volume = savedVolume;
    audio.playbackRate = savedSpeed;
  }, []);

  return {
    ...playerState,
    play,
    pause,
    resume,
    togglePlayPause,
    seek,
    setVolume,
    setSpeed,
  };
}
