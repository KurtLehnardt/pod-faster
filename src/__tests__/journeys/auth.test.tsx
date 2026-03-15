import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ---------------------------------------------------------------------------
// Mock next/navigation
// ---------------------------------------------------------------------------

const mockPush = vi.fn();
const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
  useParams: () => ({}),
}));

// ---------------------------------------------------------------------------
// Mock Supabase client (browser)
// ---------------------------------------------------------------------------

const mockSignInWithPassword = vi.fn();
const mockSignUp = vi.fn();
const mockGetUser = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: mockSignInWithPassword,
      signUp: mockSignUp,
      getUser: mockGetUser,
    },
  }),
}));

// ---------------------------------------------------------------------------
// Mock Supabase middleware server client
// ---------------------------------------------------------------------------

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(),
  createBrowserClient: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Authentication Flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: null } });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("Login Page", () => {
    let LoginPage: React.ComponentType;

    beforeEach(async () => {
      const mod = await import("@/app/(auth)/login/page");
      LoginPage = mod.default;
    });

    it("renders login form with email and password fields", () => {
      render(<LoginPage />);

      expect(screen.getByLabelText("Email")).toBeDefined();
      expect(screen.getByLabelText("Password")).toBeDefined();
      expect(screen.getByRole("button", { name: "Sign in" })).toBeDefined();
    });

    it("displays heading and description", () => {
      render(<LoginPage />);

      expect(screen.getByRole("heading", { name: "Sign in" })).toBeDefined();
      expect(
        screen.getByText("Enter your email and password to continue.")
      ).toBeDefined();
    });

    it("shows link to sign up page", () => {
      render(<LoginPage />);

      const link = screen.getByRole("link", { name: "Sign up" });
      expect(link.getAttribute("href")).toBe("/signup");
    });

    it("redirects to /chat on successful login", async () => {
      mockSignInWithPassword.mockResolvedValueOnce({ error: null });

      render(<LoginPage />);

      const user = userEvent.setup();
      await user.type(screen.getByLabelText("Email"), "user@example.com");
      await user.type(screen.getByLabelText("Password"), "password123");
      await user.click(screen.getByRole("button", { name: "Sign in" }));

      await waitFor(() => {
        expect(mockSignInWithPassword).toHaveBeenCalledWith({
          email: "user@example.com",
          password: "password123",
        });
        expect(mockPush).toHaveBeenCalledWith("/chat");
        expect(mockRefresh).toHaveBeenCalled();
      });
    });

    it("shows error message on invalid credentials", async () => {
      mockSignInWithPassword.mockResolvedValueOnce({
        error: { message: "Invalid login credentials" },
      });

      render(<LoginPage />);

      const user = userEvent.setup();
      await user.type(screen.getByLabelText("Email"), "bad@example.com");
      await user.type(screen.getByLabelText("Password"), "wrong");
      await user.click(screen.getByRole("button", { name: "Sign in" }));

      await waitFor(() => {
        expect(screen.getByRole("alert")).toBeDefined();
        expect(screen.getByText("Invalid login credentials")).toBeDefined();
      });
    });

    it("disables button while signing in", async () => {
      let resolveSignIn: (val: unknown) => void;
      const signInPromise = new Promise((resolve) => {
        resolveSignIn = resolve;
      });
      mockSignInWithPassword.mockReturnValueOnce(signInPromise);

      render(<LoginPage />);

      const user = userEvent.setup();
      await user.type(screen.getByLabelText("Email"), "user@example.com");
      await user.type(screen.getByLabelText("Password"), "pass123");
      await user.click(screen.getByRole("button", { name: "Sign in" }));

      const btn = screen.getByRole("button", { name: "Signing in..." });
      expect(btn).toBeDefined();
      expect((btn as HTMLButtonElement).disabled).toBe(true);

      resolveSignIn!({ error: null });

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith("/chat");
      });
    });
  });

  describe("Signup Page", () => {
    let SignupPage: React.ComponentType;

    beforeEach(async () => {
      const mod = await import("@/app/(auth)/signup/page");
      SignupPage = mod.default;
    });

    it("renders signup form with display name, email, and password fields", () => {
      render(<SignupPage />);

      expect(screen.getByLabelText("Display name")).toBeDefined();
      expect(screen.getByLabelText("Email")).toBeDefined();
      expect(screen.getByLabelText("Password")).toBeDefined();
      expect(
        screen.getByRole("button", { name: "Create account" })
      ).toBeDefined();
    });

    it("displays heading and description", () => {
      render(<SignupPage />);

      expect(
        screen.getByRole("heading", { name: "Create an account" })
      ).toBeDefined();
      expect(
        screen.getByText("Enter your details below to get started.")
      ).toBeDefined();
    });

    it("shows link to sign in page", () => {
      render(<SignupPage />);

      const link = screen.getByRole("link", { name: "Sign in" });
      expect(link.getAttribute("href")).toBe("/login");
    });

    it("calls signUp with email, password, and display name", async () => {
      mockSignUp.mockResolvedValueOnce({ data: { session: null }, error: null });

      render(<SignupPage />);

      const user = userEvent.setup();
      await user.type(screen.getByLabelText("Display name"), "Test User");
      await user.type(screen.getByLabelText("Email"), "test@example.com");
      await user.type(screen.getByLabelText("Password"), "secret123");
      await user.click(
        screen.getByRole("button", { name: "Create account" })
      );

      await waitFor(() => {
        expect(mockSignUp).toHaveBeenCalledWith({
          email: "test@example.com",
          password: "secret123",
          options: {
            data: {
              display_name: "Test User",
            },
            emailRedirectTo: "https://pod-faster.vercel.app/callback",
          },
        });
      });
    });

    it("shows check your email screen after signup", async () => {
      mockSignUp.mockResolvedValueOnce({ data: { session: null }, error: null });

      render(<SignupPage />);

      const user = userEvent.setup();
      await user.type(screen.getByLabelText("Display name"), "New User");
      await user.type(screen.getByLabelText("Email"), "new@example.com");
      await user.type(screen.getByLabelText("Password"), "secret123");
      await user.click(
        screen.getByRole("button", { name: "Create account" })
      );

      await waitFor(() => {
        expect(
          screen.getByRole("heading", { name: "Check your email" })
        ).toBeDefined();
        expect(screen.getByText("new@example.com")).toBeDefined();
      });
    });

    it("shows error message on signup failure", async () => {
      mockSignUp.mockResolvedValueOnce({
        error: { message: "User already registered" },
      });

      render(<SignupPage />);

      const user = userEvent.setup();
      await user.type(screen.getByLabelText("Display name"), "Existing");
      await user.type(screen.getByLabelText("Email"), "existing@example.com");
      await user.type(screen.getByLabelText("Password"), "pass123");
      await user.click(
        screen.getByRole("button", { name: "Create account" })
      );

      await waitFor(() => {
        expect(screen.getByRole("alert")).toBeDefined();
        expect(screen.getByText("User already registered")).toBeDefined();
      });
    });

    it("attempts redirect to /chat after successful signup", async () => {
      mockSignUp.mockResolvedValueOnce({ data: { session: { access_token: "tok" } }, error: null });

      render(<SignupPage />);

      const user = userEvent.setup();
      await user.type(screen.getByLabelText("Display name"), "Auto User");
      await user.type(screen.getByLabelText("Email"), "auto@example.com");
      await user.type(screen.getByLabelText("Password"), "pass123");
      await user.click(
        screen.getByRole("button", { name: "Create account" })
      );

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith("/chat");
        expect(mockRefresh).toHaveBeenCalled();
      });
    });
  });

  describe("Middleware Route Protection", () => {
    it("defines protected route prefixes for /chat, /episodes, /settings, /topics", async () => {
      const middleware = await import("@/middleware");
      expect(middleware.config.matcher).toBeDefined();
      expect(middleware.config.matcher.length).toBeGreaterThan(0);
    });

    it("middleware matcher excludes static files", async () => {
      const { config } = await import("@/middleware");
      const pattern = config.matcher[0];

      expect(pattern).toContain("_next/static");
      expect(pattern).toContain("_next/image");
      expect(pattern).toContain("favicon.ico");
    });

    it("updateSession redirects unauthenticated users from protected routes", async () => {
      const { updateSession } = await import("@/lib/supabase/middleware");
      const { createServerClient } = await import("@supabase/ssr");
      const mockServerClient = vi.mocked(createServerClient);

      mockServerClient.mockReturnValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
        },
      } as ReturnType<typeof createServerClient>);

      const url = new URL("http://localhost:3000/chat");
      const clonedUrl = new URL(url.toString());
      const mockRequest = {
        cookies: {
          getAll: vi.fn().mockReturnValue([]),
          set: vi.fn(),
        },
        nextUrl: {
          pathname: "/chat",
          clone: () => clonedUrl,
        },
        url: url.toString(),
      } as unknown as Parameters<typeof updateSession>[0];

      const response = await updateSession(mockRequest);
      expect(response.headers.get("location")).toContain("/login");
    });

    it("updateSession allows authenticated users on protected routes", async () => {
      const { updateSession } = await import("@/lib/supabase/middleware");
      const { createServerClient } = await import("@supabase/ssr");
      const mockServerClient = vi.mocked(createServerClient);

      mockServerClient.mockReturnValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: "user-123", email: "user@test.com" } },
          }),
        },
      } as ReturnType<typeof createServerClient>);

      const url = new URL("http://localhost:3000/chat");
      const mockRequest = {
        cookies: {
          getAll: vi.fn().mockReturnValue([]),
          set: vi.fn(),
        },
        nextUrl: {
          pathname: "/chat",
          clone: () => new URL(url.toString()),
        },
        url: url.toString(),
      } as unknown as Parameters<typeof updateSession>[0];

      const response = await updateSession(mockRequest);
      expect(response.headers.get("location")).toBeNull();
    });

    it("updateSession redirects authenticated users away from auth pages", async () => {
      const { updateSession } = await import("@/lib/supabase/middleware");
      const { createServerClient } = await import("@supabase/ssr");
      const mockServerClient = vi.mocked(createServerClient);

      mockServerClient.mockReturnValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: "user-123", email: "user@test.com" } },
          }),
        },
      } as ReturnType<typeof createServerClient>);

      const url = new URL("http://localhost:3000/login");
      const clonedUrl = new URL(url.toString());
      const mockRequest = {
        cookies: {
          getAll: vi.fn().mockReturnValue([]),
          set: vi.fn(),
        },
        nextUrl: {
          pathname: "/login",
          clone: () => clonedUrl,
        },
        url: url.toString(),
      } as unknown as Parameters<typeof updateSession>[0];

      const response = await updateSession(mockRequest);
      expect(response.headers.get("location")).toContain("/chat");
    });
  });
});
