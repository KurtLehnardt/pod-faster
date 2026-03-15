import { TopicList } from "@/components/topics/topic-list";

export default function TopicsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Topics</h2>
        <p className="mt-2 text-muted-foreground">
          Manage your podcast topics and interests.
        </p>
      </div>
      <TopicList />
    </div>
  );
}
