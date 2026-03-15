import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ---------------------------------------------------------------------------
// Mock next/navigation
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
  useParams: () => ({}),
  usePathname: () => "/topics",
}));

// ---------------------------------------------------------------------------
// Mock Supabase client (browser)
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
// Mock sonner toast
// ---------------------------------------------------------------------------

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
  Toaster: () => null,
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Topics Management Flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-123" } },
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("TopicList Component", () => {
    let TopicList: typeof import("@/components/topics/topic-list").TopicList;

    const sampleTopics = [
      {
        id: "topic-1",
        user_id: "user-123",
        name: "Artificial Intelligence",
        description: "Latest AI developments and research",
        is_active: true,
        created_at: "2026-03-15T10:00:00Z",
      },
      {
        id: "topic-2",
        user_id: "user-123",
        name: "Quantum Computing",
        description: null,
        is_active: false,
        created_at: "2026-03-14T08:00:00Z",
      },
      {
        id: "topic-3",
        user_id: "user-123",
        name: "Climate Tech",
        description: "Green technology and climate solutions",
        is_active: true,
        created_at: "2026-03-13T09:00:00Z",
      },
    ];

    beforeEach(async () => {
      const mod = await import("@/components/topics/topic-list");
      TopicList = mod.TopicList;
    });

    it("renders list of topics with names", () => {
      render(<TopicList initialTopics={sampleTopics} userId="user-123" />);

      expect(screen.getByText("Artificial Intelligence")).toBeDefined();
      expect(screen.getByText("Quantum Computing")).toBeDefined();
      expect(screen.getByText("Climate Tech")).toBeDefined();
    });

    it("shows topic descriptions when present", () => {
      render(<TopicList initialTopics={sampleTopics} userId="user-123" />);

      expect(
        screen.getByText("Latest AI developments and research")
      ).toBeDefined();
      expect(
        screen.getByText("Green technology and climate solutions")
      ).toBeDefined();
    });

    it("shows Add Topic button", () => {
      render(<TopicList initialTopics={sampleTopics} userId="user-123" />);

      expect(screen.getByText("Add Topic")).toBeDefined();
    });

    it("shows empty state when no topics", () => {
      render(<TopicList initialTopics={[]} userId="user-123" />);

      expect(screen.getByText("No topics yet")).toBeDefined();
      expect(
        screen.getByText("Add topics to organize your podcast content.")
      ).toBeDefined();
    });

    it("shows add topic form when Add Topic is clicked", async () => {
      render(<TopicList initialTopics={[]} userId="user-123" />);

      const user = userEvent.setup();
      await user.click(screen.getByText("Add Topic"));

      await waitFor(() => {
        expect(screen.getByText("New Topic")).toBeDefined();
        expect(screen.getByLabelText("Name")).toBeDefined();
        expect(screen.getByLabelText("Description (optional)")).toBeDefined();
      });
    });

    it("creates new topic and adds it to the list", async () => {
      const newTopic = {
        id: "topic-new",
        user_id: "user-123",
        name: "Space Exploration",
        description: "Mars missions and beyond",
        is_active: true,
        created_at: "2026-03-15T12:00:00Z",
      };

      const mockInsertSelect = vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: newTopic, error: null }),
      });
      const mockInsert = vi.fn().mockReturnValue({
        select: mockInsertSelect,
      });

      mockFrom.mockReturnValue({
        insert: mockInsert,
      });

      render(<TopicList initialTopics={[]} userId="user-123" />);

      const user = userEvent.setup();

      // Open form
      await user.click(screen.getByText("Add Topic"));

      // Fill in topic details
      await user.type(screen.getByLabelText("Name"), "Space Exploration");
      await user.type(
        screen.getByLabelText("Description (optional)"),
        "Mars missions and beyond"
      );

      // Submit
      const addButton = screen.getByRole("button", { name: "Add Topic" });
      await user.click(addButton);

      await waitFor(() => {
        expect(mockFrom).toHaveBeenCalledWith("topics");
        expect(mockInsert).toHaveBeenCalledWith({
          user_id: "user-123",
          name: "Space Exploration",
          description: "Mars missions and beyond",
          is_active: true,
        });
        expect(screen.getByText("Space Exploration")).toBeDefined();
        expect(mockToastSuccess).toHaveBeenCalledWith("Topic added");
      });
    });

    it("shows error toast when adding topic fails", async () => {
      const mockInsertSelect = vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: null,
          error: { message: "DB error" },
        }),
      });
      const mockInsert = vi.fn().mockReturnValue({
        select: mockInsertSelect,
      });

      mockFrom.mockReturnValue({
        insert: mockInsert,
      });

      render(<TopicList initialTopics={[]} userId="user-123" />);

      const user = userEvent.setup();
      await user.click(screen.getByText("Add Topic"));
      await user.type(screen.getByLabelText("Name"), "Failing Topic");
      await user.click(screen.getByRole("button", { name: "Add Topic" }));

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith("Failed to add topic");
      });
    });

    it("hides form and clears inputs when Cancel is clicked", async () => {
      render(<TopicList initialTopics={sampleTopics} userId="user-123" />);

      const user = userEvent.setup();
      await user.click(screen.getByText("Add Topic"));

      // Form should be visible
      expect(screen.getByText("New Topic")).toBeDefined();

      await user.type(screen.getByLabelText("Name"), "Draft Topic");
      await user.click(screen.getByText("Cancel"));

      // Form should be hidden, back to showing "Add Topic" button
      await waitFor(() => {
        expect(screen.queryByText("New Topic")).toBeNull();
        expect(screen.getByText("Add Topic")).toBeDefined();
      });
    });

    it("toggles topic active/inactive via switch", async () => {
      const mockUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      mockFrom.mockReturnValue({
        update: mockUpdate,
      });

      render(<TopicList initialTopics={sampleTopics} userId="user-123" />);

      // The first topic (AI) is active. Find the switch elements.
      // There should be 3 switches (one per topic)
      const switches = document.querySelectorAll('[data-slot="switch"]');
      expect(switches.length).toBe(3);

      // Click the first switch (AI topic - active -> inactive)
      const user = userEvent.setup();
      await user.click(switches[0] as HTMLElement);

      await waitFor(() => {
        expect(mockFrom).toHaveBeenCalledWith("topics");
        expect(mockUpdate).toHaveBeenCalledWith({ is_active: false });
      });
    });

    it("deletes topic and removes it from list", async () => {
      const mockDelete = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      mockFrom.mockReturnValue({
        delete: mockDelete,
      });

      render(<TopicList initialTopics={sampleTopics} userId="user-123" />);

      // Find delete button for first topic
      const deleteButton = screen.getByLabelText("Delete Artificial Intelligence");

      const user = userEvent.setup();
      await user.click(deleteButton);

      await waitFor(() => {
        expect(mockFrom).toHaveBeenCalledWith("topics");
        expect(mockToastSuccess).toHaveBeenCalledWith("Topic deleted");
        // Topic should be removed from the DOM
        expect(screen.queryByText("Artificial Intelligence")).toBeNull();
      });
    });

    it("reverts deletion on error", async () => {
      const mockDelete = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({
          error: { message: "Delete failed" },
        }),
      });

      mockFrom.mockReturnValue({
        delete: mockDelete,
      });

      render(<TopicList initialTopics={sampleTopics} userId="user-123" />);

      const deleteButton = screen.getByLabelText("Delete Artificial Intelligence");

      const user = userEvent.setup();
      await user.click(deleteButton);

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith("Failed to delete topic");
        // Topic should still be in the DOM after revert
        expect(screen.getByText("Artificial Intelligence")).toBeDefined();
      });
    });

    it("disables Add Topic button when name is empty", async () => {
      render(<TopicList initialTopics={[]} userId="user-123" />);

      const user = userEvent.setup();
      await user.click(screen.getByText("Add Topic"));

      // The "Add Topic" button in the form should be disabled when name is empty
      const addButton = screen.getByRole("button", { name: "Add Topic" });
      expect((addButton as HTMLButtonElement).disabled).toBe(true);
    });
  });

  describe("Topics Page", () => {
    let TopicsPage: React.ComponentType;

    beforeEach(async () => {
      const mod = await import("@/app/(app)/topics/page");
      TopicsPage = mod.default;
    });

    it("displays page heading and description", async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          }),
        }),
      });

      render(<TopicsPage />);

      await waitFor(() => {
        expect(screen.getByText("Topics")).toBeDefined();
        expect(
          screen.getByText("Manage your podcast topics and interests.")
        ).toBeDefined();
      });
    });

    it("loads topics from Supabase", async () => {
      const selectChain = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({
            data: [
              {
                id: "t-1",
                user_id: "user-123",
                name: "AI",
                description: null,
                is_active: true,
                created_at: "2026-03-15T10:00:00Z",
              },
            ],
            error: null,
          }),
        }),
      });

      mockFrom.mockReturnValue({
        select: selectChain,
      });

      render(<TopicsPage />);

      await waitFor(() => {
        expect(mockFrom).toHaveBeenCalledWith("topics");
        expect(screen.getByText("AI")).toBeDefined();
      });
    });
  });
});
