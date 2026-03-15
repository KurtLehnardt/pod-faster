import { describe, it, expect } from "vitest";
import { chatAssistantSystemPrompt } from "../chat";

describe("chat", () => {
  describe("chatAssistantSystemPrompt", () => {
    it("returns a non-empty system prompt", () => {
      const prompt = chatAssistantSystemPrompt();
      expect(typeof prompt).toBe("string");
      expect(prompt.length).toBeGreaterThan(50);
    });

    it("mentions available styles", () => {
      const prompt = chatAssistantSystemPrompt();
      expect(prompt).toContain("monologue");
      expect(prompt).toContain("interview");
      expect(prompt).toContain("group_chat");
    });

    it("mentions available tones", () => {
      const prompt = chatAssistantSystemPrompt();
      expect(prompt).toContain("serious");
      expect(prompt).toContain("lighthearted");
      expect(prompt).toContain("dark_mystery");
      expect(prompt).toContain("business_news");
    });
  });
});
