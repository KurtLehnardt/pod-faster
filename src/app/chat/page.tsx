import { ChatInterface } from "@/components/chat/chat-interface";

export const metadata = {
  title: "Chat - pod-faster",
  description: "Explore topics and configure podcast episodes with AI.",
};

export default function ChatPage() {
  return (
    <main className="flex h-dvh flex-col">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h1 className="text-lg font-semibold tracking-tight">pod-faster</h1>
        <span className="text-xs text-muted-foreground">Chat</span>
      </header>
      <div className="flex-1 overflow-hidden">
        <ChatInterface />
      </div>
    </main>
  );
}
