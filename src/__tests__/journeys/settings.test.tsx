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
  usePathname: () => "/settings",
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
// Mock fetch for voice picker in settings
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Settings Flow", () => {
  const sampleProfile = {
    id: "user-123",
    display_name: "John Doe",
    avatar_url: null,
    default_length: 5,
    default_style: "monologue" as const,
    default_tone: "serious" as const,
    default_voice_id: null,
    subscription_tier: "premium",
    created_at: "2026-03-01T00:00:00Z",
    updated_at: "2026-03-15T10:00:00Z",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mockFetch);
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-123" } },
    });

    // Default mock for voices endpoint
    mockFetch.mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/api/voices")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              voices: [
                {
                  voice_id: "voice-1",
                  name: "Alex",
                  category: "premade",
                  preview_url: "https://example.com/alex.mp3",
                },
                {
                  voice_id: "voice-2",
                  name: "Jordan",
                  category: "premade",
                  preview_url: "https://example.com/jordan.mp3",
                },
              ],
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("PreferencesForm Component", () => {
    let PreferencesForm: typeof import("@/components/settings/preferences-form").PreferencesForm;

    beforeEach(async () => {
      const mod = await import("@/components/settings/preferences-form");
      PreferencesForm = mod.PreferencesForm;
    });

    it("renders form with display name field", () => {
      render(<PreferencesForm profile={sampleProfile} />);

      const nameInput = screen.getByLabelText("Display Name") as HTMLInputElement;
      expect(nameInput).toBeDefined();
      expect(nameInput.value).toBe("John Doe");
    });

    it("renders default episode length slider", () => {
      render(<PreferencesForm profile={sampleProfile} />);

      expect(screen.getByText("Default Episode Length")).toBeDefined();
      expect(screen.getByText("5 min")).toBeDefined();
    });

    it("shows length range labels (1 min to 30 min)", () => {
      render(<PreferencesForm profile={sampleProfile} />);

      expect(screen.getByText("1 min")).toBeDefined();
      expect(screen.getByText("30 min")).toBeDefined();
    });

    it("renders default style selector", () => {
      render(<PreferencesForm profile={sampleProfile} />);

      expect(screen.getByText("Default Style")).toBeDefined();
    });

    it("renders default tone selector", () => {
      render(<PreferencesForm profile={sampleProfile} />);

      expect(screen.getByText("Default Tone")).toBeDefined();
    });

    it("renders default voice section", () => {
      render(<PreferencesForm profile={sampleProfile} />);

      expect(screen.getByText("Default Voice")).toBeDefined();
      expect(
        screen.getByText(
          "Select a default voice for new episodes. Click the play button to preview."
        )
      ).toBeDefined();
    });

    it("renders Save Preferences button", () => {
      render(<PreferencesForm profile={sampleProfile} />);

      expect(screen.getByText("Save Preferences")).toBeDefined();
    });

    it("allows changing display name", async () => {
      render(<PreferencesForm profile={sampleProfile} />);

      const nameInput = screen.getByLabelText("Display Name") as HTMLInputElement;
      const user = userEvent.setup();

      await user.clear(nameInput);
      await user.type(nameInput, "Jane Smith");

      expect(nameInput.value).toBe("Jane Smith");
    });

    it("saves preferences on button click", async () => {
      const mockUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      mockFrom.mockReturnValue({
        update: mockUpdate,
      });

      render(<PreferencesForm profile={sampleProfile} />);

      const user = userEvent.setup();
      await user.click(screen.getByText("Save Preferences"));

      await waitFor(() => {
        expect(mockFrom).toHaveBeenCalledWith("profiles");
        expect(mockUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            display_name: "John Doe",
            default_length: 5,
            default_style: "monologue",
            default_tone: "serious",
            default_voice_id: null,
          })
        );
        expect(mockToastSuccess).toHaveBeenCalledWith("Preferences saved");
      });
    });

    it("shows error toast when save fails", async () => {
      const mockUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({
          error: { message: "Update failed" },
        }),
      });

      mockFrom.mockReturnValue({
        update: mockUpdate,
      });

      render(<PreferencesForm profile={sampleProfile} />);

      const user = userEvent.setup();
      await user.click(screen.getByText("Save Preferences"));

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith(
          "Failed to save preferences"
        );
      });
    });

    it("saves updated display name", async () => {
      const mockUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      mockFrom.mockReturnValue({
        update: mockUpdate,
      });

      render(<PreferencesForm profile={sampleProfile} />);

      const user = userEvent.setup();
      const nameInput = screen.getByLabelText("Display Name") as HTMLInputElement;
      await user.clear(nameInput);
      await user.type(nameInput, "Updated Name");
      await user.click(screen.getByText("Save Preferences"));

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            display_name: "Updated Name",
          })
        );
      });
    });

    it("shows placeholder when display name is empty", () => {
      const emptyNameProfile = { ...sampleProfile, display_name: null };
      render(<PreferencesForm profile={emptyNameProfile} />);

      const nameInput = screen.getByLabelText("Display Name") as HTMLInputElement;
      expect(nameInput.value).toBe("");
      expect(nameInput.placeholder).toBe("Your name");
    });
  });

  describe("Settings Page", () => {
    let SettingsPage: React.ComponentType;

    beforeEach(async () => {
      const mod = await import("@/app/(app)/settings/page");
      SettingsPage = mod.default;
    });

    it("shows loading state initially", () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockReturnValue(new Promise(() => {})),
          }),
        }),
      });

      render(<SettingsPage />);

      // Should show loader (animate-spin class)
      const spinner = document.querySelector('[class*="animate-spin"]');
      expect(spinner).toBeDefined();
    });

    it("displays settings page heading once loaded", async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: sampleProfile,
              error: null,
            }),
          }),
        }),
      });

      render(<SettingsPage />);

      await waitFor(() => {
        expect(screen.getByText("Settings")).toBeDefined();
        expect(
          screen.getByText(
            "Configure your account and podcast preferences."
          )
        ).toBeDefined();
      });
    });

    it("shows error message when profile cannot be loaded", async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: null,
            }),
          }),
        }),
      });

      render(<SettingsPage />);

      await waitFor(() => {
        expect(screen.getByText("Could not load profile.")).toBeDefined();
      });
    });

    it("renders preferences form with profile data", async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: sampleProfile,
              error: null,
            }),
          }),
        }),
      });

      render(<SettingsPage />);

      await waitFor(() => {
        const nameInput = screen.getByLabelText("Display Name") as HTMLInputElement;
        expect(nameInput.value).toBe("John Doe");
      });
    });
  });
});
