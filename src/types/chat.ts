export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}
