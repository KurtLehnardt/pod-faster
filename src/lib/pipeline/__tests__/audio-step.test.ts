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
    it("makes a single TTS call with all segment texts joined", async () => {
      mockTTS.mockResolvedValueOnce({
        audio: fakeAudioBuffer(250),
        requestId: "req-1",
        characterCount: 55,
      });

      const script = makeMonologueScript();
      const result = await audioStep({ script, style: "monologue" });

      expect(mockTTS).toHaveBeenCalledTimes(1);
      expect(mockDialogue).not.toHaveBeenCalled();

      // Single call with joined text, no previousRequestIds
      expect(mockTTS.mock.calls[0][0]).toEqual({
        text: "Welcome to the show.\n\nToday we discuss important topics.",
        voiceId: "voice-host",
        modelId: undefined,
      });

      expect(result.audio.byteLength).toBe(250);

      const expectedChars = "Welcome to the show.".length +
        "Today we discuss important topics.".length;
      expect(result.charactersUsed).toBe(expectedChars);
    });

    it("uses multilingual model for non-English language", async () => {
      mockTTS.mockResolvedValueOnce({
        audio: fakeAudioBuffer(200),
        requestId: "req-1",
        characterCount: 55,
      });

      const script = makeMonologueScript();
      await audioStep({ script, style: "monologue", language: "de" });

      expect(mockTTS.mock.calls[0][0].modelId).toBe("eleven_multilingual_v2");
    });

    it("uses default model for English language", async () => {
      mockTTS.mockResolvedValueOnce({
        audio: fakeAudioBuffer(200),
        requestId: "req-1",
        characterCount: 55,
      });

      const script = makeMonologueScript();
      await audioStep({ script, style: "monologue", language: "en" });

      expect(mockTTS.mock.calls[0][0].modelId).toBeUndefined();
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

    it("passes multilingual model to dialogue API for non-English", async () => {
      mockDialogue.mockResolvedValue({
        audio: fakeAudioBuffer(500),
        characterCount: 80,
        usedDialogueApi: true,
      });

      const script = makeInterviewScript();
      await audioStep({ script, style: "interview", language: "es" });

      expect(mockDialogue.mock.calls[0][0]).toEqual({
        segments: expect.any(Array),
        modelId: "eleven_multilingual_v2",
      });
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
});
