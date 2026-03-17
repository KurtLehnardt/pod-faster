import { describe, it, expect, vi, beforeEach } from "vitest";
import { createChain } from "@/__tests__/helpers/mock-supabase";

// -- Mock Supabase admin client ------------------------------------------------

const mockFrom = vi.fn(() => createChain());

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mockFrom }),
}));

import { checkFeatureAccess } from "@/lib/auth/feature-gate";

// -- Helpers ------------------------------------------------------------------

function mockProfileTier(tier: string | null, error: unknown = null) {
  mockFrom.mockImplementationOnce(() => {
    const chain = createChain();
    chain.single.mockResolvedValue({
      data: error ? null : { subscription_tier: tier },
      error,
    });
    return chain;
  });
}

// -- Tests --------------------------------------------------------------------

describe("checkFeatureAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockImplementation(() => createChain());
  });

  it("allows premium user to access auto_transcribe", async () => {
    mockProfileTier("premium");

    const result = await checkFeatureAccess("user-1", "auto_transcribe");

    expect(result.allowed).toBe(true);
    expect(result.requiredTier).toBe("premium");
    expect(result.currentTier).toBe("premium");
  });

  it("denies pro user access to auto_transcribe (requires premium)", async () => {
    mockProfileTier("pro");

    const result = await checkFeatureAccess("user-2", "auto_transcribe");

    expect(result.allowed).toBe(false);
    expect(result.requiredTier).toBe("premium");
    expect(result.currentTier).toBe("pro");
  });

  it("denies free user access to auto_transcribe", async () => {
    mockProfileTier("free");

    const result = await checkFeatureAccess("user-3", "auto_transcribe");

    expect(result.allowed).toBe(false);
    expect(result.requiredTier).toBe("premium");
    expect(result.currentTier).toBe("free");
  });

  it("denies access for unknown feature (fail-closed)", async () => {
    // Should not even query the DB for unknown features
    const result = await checkFeatureAccess("user-4", "unknown_feature");

    expect(result.allowed).toBe(false);
    expect(result.requiredTier).toBe("premium");
    expect(result.currentTier).toBe("free");
    // No DB call should have been made
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("denies access on DB error (fail-closed)", async () => {
    mockProfileTier(null, { message: "connection refused" });

    const result = await checkFeatureAccess("user-5", "auto_transcribe");

    expect(result.allowed).toBe(false);
    expect(result.requiredTier).toBe("premium");
    expect(result.currentTier).toBe("free");
  });

  it("treats null subscription_tier as free (denied)", async () => {
    mockProfileTier(null);

    const result = await checkFeatureAccess("user-6", "auto_transcribe");

    expect(result.allowed).toBe(false);
    expect(result.requiredTier).toBe("premium");
    expect(result.currentTier).toBe("free");
  });
});
