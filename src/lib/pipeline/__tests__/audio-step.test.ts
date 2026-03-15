import { describe, it, expect, vi, beforeEach } from "vitest";
import { audioStep } from "../audio-step";
import type { EpisodeScript } from "@/types/episode";

vi.mock("@/lib/elevenlabs/tts", () => ({
  textToSpeech: vi.fn(),
}));

vi.mock("@/lib/elevenlabs/dialogue", () => ({
  textToDialogue: vi.fn(),
}));

import { textToSpeech } from "@/lib/elevenlabs/tts";
import { textToDialogue } from "@/lib/elevenlabs/dialogue";
const mockTTS = vi.mocked(textToSpeech);
const mockDialogue = vi.mocked(textToDialogue);

beforeEach(() => {
  vi.clearAllMocks();
});

function makeMonologueScript(): EpisodeScript {
  return {
    title: "Test Monologue Episode",
    segments: [
      {
        speaker: "Host",
        text: "Welcome to the show.",
        voice_id: "voice-host",
      },
      {
        speaker: "Host",
        text: "Today we discuss important topics.",
        voice_id: "voice-host",
      },
    ],
  };
}

function makeInterviewScript(): EpisodeScript {
  return {
    title: "Test Interview Episode",
    segments: [
      {
        speaker: "Host",
        text: "Welcome. Today we have an expert.",
        voice_id: "voice-host",
      },
      {
        speaker: "Expert",
        text: "Thanks for having me.",
        voice_id: "voice-expert",
      },
      {
        speaker: "Host",
        text: "Tell us more.",
        voice_id: "voice-host",
      },
    ],
  };
}

function makeGroupChatScript(): EpisodeScript {
  return {
    title: "Test Group Chat Episode",
    segments: [
      { speaker: "Alex", text: "Hey everyone.", voice_id: "voice-1" },
      { speaker: "Jordan", text: "Hey Alex!", voice_id: "voice-2" },
      { speaker: "Sam", text: "What are we talking about?", voice_id: "voice-3" },
    ],
  };
}

function fakeAudioBuffer(size: number): ArrayBuffer {
  return new Uint8Array(size).buffer;
}

describe("audioStep", () => {
  describe("monologue style", () => {
    it("calls textToSpeech for each segment sequentially", async () => {
      mockTTS
        .mockResolvedValueOnce({
          audio: fakeAudioBuffer(100),
          requestId: "req-1",
          characterCount: 20,
        })
        .mockResolvedValueOnce({
          audio: fakeAudioBuffer(150),
          requestId: "req-2",
          characterCount: 35,
        });

      const script = makeMonologueScript();
      const result = await audioStep({ script, style: "monologue" });

      expect(mockTTS).toHaveBeenCalledTimes(2);
      expect(mockDialogue).not.toHaveBeenCalled();

      // First call has no previous request IDs
      expect(mockTTS.mock.calls[0][0]).toEqual({
        text: "Welcome to the show.",
        voiceId: "voice-host",
        previousRequestIds: [],
      });

      // Second call includes the first request ID for continuity
      expect(mockTTS.mock.calls[1][0]).toEqual({
        text: "Today we discuss important topics.",
        voiceId: "voice-host",
        previousRequestIds: ["req-1"],
      });

      // Audio buffers are concatenated
      expect(result.audio.byteLength).toBe(250); // 100 + 150

      // Character count is sum of all segment text lengths
      const expectedChars = "Welcome to the show.".length +
        "Today we discuss important topics.".length;
      expect(result.charactersUsed).toBe(expectedChars);
    });

    it("handles segments where requestId is null", async () => {
      mockTTS
        .mockResolvedValueOnce({
          audio: fakeAudioBuffer(50),
          requestId: null,
          characterCount: 10,
        })
        .mockResolvedValueOnce({
          audio: fakeAudioBuffer(50),
          requestId: "req-2",
          characterCount: 10,
        });

      const script = makeMonologueScript();
      await audioStep({ script, style: "monologue" });

      // Second call should have empty previousRequestIds since first was null
      expect(mockTTS.mock.calls[1][0].previousRequestIds).toEqual([]);
    });
  });

  describe("interview style", () => {
    it("uses the dialogue API for multi-voice content", async () => {
      mockDialogue.mockResolvedValue({
        audio: fakeAudioBuffer(500),
        characterCount: 80,
        usedDialogueApi: true,
      });

      const script = makeInterviewScript();
      const result = await audioStep({ script, style: "interview" });

      expect(mockDialogue).toHaveBeenCalledOnce();
      expect(mockTTS).not.toHaveBeenCalled();

      expect(mockDialogue.mock.calls[0][0]).toEqual({
        segments: [
          { text: "Welcome. Today we have an expert.", voice_id: "voice-host" },
          { text: "Thanks for having me.", voice_id: "voice-expert" },
          { text: "Tell us more.", voice_id: "voice-host" },
        ],
      });

      expect(result.audio.byteLength).toBe(500);
      const expectedChars =
        "Welcome. Today we have an expert.".length +
        "Thanks for having me.".length +
        "Tell us more.".length;
      expect(result.charactersUsed).toBe(expectedChars);
    });
  });

  describe("group_chat style", () => {
    it("uses the dialogue API for group chat", async () => {
      mockDialogue.mockResolvedValue({
        audio: fakeAudioBuffer(600),
        characterCount: 60,
        usedDialogueApi: true,
      });

      const script = makeGroupChatScript();
      const result = await audioStep({ script, style: "group_chat" });

      expect(mockDialogue).toHaveBeenCalledOnce();
      expect(mockTTS).not.toHaveBeenCalled();

      expect(mockDialogue.mock.calls[0][0].segments).toHaveLength(3);
      expect(result.audio.byteLength).toBe(600);
    });
  });

  describe("error handling", () => {
    it("throws when script has no segments", async () => {
      const emptyScript: EpisodeScript = {
        title: "Empty",
        segments: [],
      };

      await expect(
        audioStep({ script: emptyScript, style: "monologue" }),
      ).rejects.toThrow("Cannot generate audio: script has no segments");
    });

    it("propagates textToSpeech errors in monologue mode", async () => {
      mockTTS.mockRejectedValue(new Error("ElevenLabs quota exceeded"));

      const script = makeMonologueScript();
      await expect(
        audioStep({ script, style: "monologue" }),
      ).rejects.toThrow("ElevenLabs quota exceeded");
    });

    it("propagates textToDialogue errors in interview mode", async () => {
      mockDialogue.mockRejectedValue(new Error("Dialogue API error"));

      const script = makeInterviewScript();
      await expect(
        audioStep({ script, style: "interview" }),
      ).rejects.toThrow("Dialogue API error");
    });
  });

  describe("voice continuity in monologue", () => {
    it("passes at most 3 previous request IDs (sliding window)", async () => {
      const script: EpisodeScript = {
        title: "Long Monologue",
        segments: Array.from({ length: 5 }, (_, i) => ({
          speaker: "Host",
          text: `Segment ${i + 1} text here.`,
          voice_id: "voice-host",
        })),
      };

      for (let i = 0; i < 5; i++) {
        mockTTS.mockResolvedValueOnce({
          audio: fakeAudioBuffer(10),
          requestId: `req-${i + 1}`,
          characterCount: 20,
        });
      }

      await audioStep({ script, style: "monologue" });

      // 1st call: no previous IDs
      expect(mockTTS.mock.calls[0][0].previousRequestIds).toEqual([]);
      // 2nd call: [req-1]
      expect(mockTTS.mock.calls[1][0].previousRequestIds).toEqual(["req-1"]);
      // 3rd call: [req-1, req-2]
      expect(mockTTS.mock.calls[2][0].previousRequestIds).toEqual(["req-1", "req-2"]);
      // 4th call: [req-1, req-2, req-3] (max 3)
      expect(mockTTS.mock.calls[3][0].previousRequestIds).toEqual([
        "req-1",
        "req-2",
        "req-3",
      ]);
      // 5th call: [req-2, req-3, req-4] (sliding window of last 3)
      expect(mockTTS.mock.calls[4][0].previousRequestIds).toEqual([
        "req-2",
        "req-3",
        "req-4",
      ]);
    });
  });
});
