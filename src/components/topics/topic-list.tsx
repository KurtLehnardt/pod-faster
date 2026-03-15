"use client";

import { useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database.types";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardAction,
} from "@/components/ui/card";
import { toast } from "sonner";
import { Plus, Trash2, FolderOpen } from "lucide-react";

type Topic = Database["public"]["Tables"]["topics"]["Row"];

interface TopicListProps {
  initialTopics: Topic[];
  userId: string;
}

export function TopicList({ initialTopics, userId }: TopicListProps) {
  const [topics, setTopics] = useState<Topic[]>(initialTopics);
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [addingTopic, setAddingTopic] = useState(false);

  const handleToggle = useCallback(
    async (topicId: string, currentActive: boolean) => {
      const newActive = !currentActive;
      // Optimistic update
      setTopics((prev) =>
        prev.map((t) =>
          t.id === topicId ? { ...t, is_active: newActive } : t
        )
      );

      const supabase = createClient();
      const { error } = await supabase
        .from("topics")
        .update({ is_active: newActive })
        .eq("id", topicId);

      if (error) {
        // Revert on failure
        setTopics((prev) =>
          prev.map((t) =>
            t.id === topicId ? { ...t, is_active: currentActive } : t
          )
        );
        toast.error("Failed to update topic");
      }
    },
    []
  );

  const handleDelete = useCallback(async (topicId: string) => {
    const previous = topics;
    // Optimistic removal
    setTopics((prev) => prev.filter((t) => t.id !== topicId));

    const supabase = createClient();
    const { error } = await supabase
      .from("topics")
      .delete()
      .eq("id", topicId);

    if (error) {
      setTopics(previous);
      toast.error("Failed to delete topic");
    } else {
      toast.success("Topic deleted");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topics]);

  const handleAdd = useCallback(async () => {
    const trimmedName = newName.trim();
    if (!trimmedName) return;

    setAddingTopic(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("topics")
        .insert({
          user_id: userId,
          name: trimmedName,
          description: newDescription.trim() || null,
          is_active: true,
        })
        .select("id, user_id, name, description, is_active, created_at")
        .single<Topic>();

      if (error || !data) throw error;
      setTopics((prev) => [data, ...prev]);
      setNewName("");
      setNewDescription("");
      setShowForm(false);
      toast.success("Topic added");
    } catch {
      toast.error("Failed to add topic");
    } finally {
      setAddingTopic(false);
    }
  }, [newName, newDescription, userId]);

  return (
    <div className="space-y-4">
      {/* Add Topic */}
      {showForm ? (
        <Card>
          <CardHeader>
            <CardTitle>New Topic</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="topic-name">Name</Label>
                <Input
                  id="topic-name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. AI & Machine Learning"
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="topic-desc">Description (optional)</Label>
                <Textarea
                  id="topic-desc"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Brief description of what this topic covers..."
                  rows={2}
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={handleAdd} disabled={addingTopic || !newName.trim()}>
                  {addingTopic ? "Adding..." : "Add Topic"}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setShowForm(false);
                    setNewName("");
                    setNewDescription("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Button onClick={() => setShowForm(true)}>
          <Plus className="mr-1.5 size-4" />
          Add Topic
        </Button>
      )}

      {/* Topics List */}
      {topics.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center">
          <FolderOpen className="mb-3 size-10 text-muted-foreground/50" />
          <p className="text-sm font-medium">No topics yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add topics to organize your podcast content.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {topics.map((topic) => (
            <Card key={topic.id} size="sm">
              <CardHeader>
                <CardTitle
                  className={
                    topic.is_active ? "" : "text-muted-foreground line-through"
                  }
                >
                  {topic.name}
                </CardTitle>
                <CardAction>
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={topic.is_active}
                      onCheckedChange={() =>
                        handleToggle(topic.id, topic.is_active)
                      }
                      size="sm"
                    />
                    <button
                      type="button"
                      onClick={() => handleDelete(topic.id)}
                      className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      aria-label={`Delete ${topic.name}`}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </CardAction>
              </CardHeader>
              {topic.description && (
                <CardContent>
                  <p className="text-xs text-muted-foreground">
                    {topic.description}
                  </p>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
