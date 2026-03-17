import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Supabase admin client ──────────────────────────────

const mockRpc = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mockRpc }),
}));

import {
  checkTierBudget,
  TIER_MONTHLY_CAP_CENTS,
  FREE_TIER_WEEKLY_LIMIT,
} from "../tier-budget";

// ── Setup ───────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockRpc.mockReset();
});

/** Helper: mock sequential RPC calls (monthly cost, then weekly count). */
function mockRpcValues(monthlyCost: number, weeklyCount: number) {
  mockRpc
    .mockResolvedValueOnce({ data: monthlyCost, error: null })
    .mockResolvedValueOnce({ data: weeklyCount, error: null });
}

// ── Tests ───────────────────────────────────────────────────

describe("checkTierBudget", () => {
  it("returns allowed when pro user is under budget", async () => {
    mockRpcValues(200, 0);

    const result = await checkTierBudget("user-1", "pro");

    expect(result.allowed).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.usedCentsThisMonth).toBe(200);
    expect(result.remainingCents).toBe(TIER_MONTHLY_CAP_CENTS.pro - 200);
  });

  it("returns not allowed when pro user exceeds monthly cap", async () => {
    mockRpcValues(1000, 0);

    const result = await checkTierBudget("user-1", "pro");

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Monthly transcription budget exhausted");
    expect(result.remainingCents).toBe(0);
  });

  it("free tier: returns not allowed when weekly clip limit reached", async () => {
    mockRpcValues(50, FREE_TIER_WEEKLY_LIMIT); // 1 clip used this week

    const result = await checkTierBudget("user-1", "free");

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("1 preview clip per week");
    expect(result.weeklyClipsUsed).toBe(FREE_TIER_WEEKLY_LIMIT);
  });

  it("free tier: returns allowed when under both monthly and weekly limits", async () => {
    mockRpcValues(0, 0);

    const result = await checkTierBudget("user-1", "free");

    expect(result.allowed).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.weeklyClipsUsed).toBe(0);
    expect(result.remainingCents).toBe(TIER_MONTHLY_CAP_CENTS.free);
  });

  it("rejects when estimatedCostCents > remainingCents and remaining < 50% of cap", async () => {
    // Pro cap = 1000. Used 600 → remaining = 400 (40% of cap). Estimate = 500.
    mockRpcValues(600, 0);

    const result = await checkTierBudget("user-1", "pro", 500);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Estimated cost");
    expect(result.reason).toContain("exceeds remaining budget");
  });

  it("allows (soft cap) when remaining > 50% even if estimated > remaining", async () => {
    // Pro cap = 1000. Used 200 → remaining = 800 (80% of cap). Estimate = 900.
    mockRpcValues(200, 0);

    const result = await checkTierBudget("user-1", "pro", 900);

    expect(result.allowed).toBe(true);
    expect(result.reason).toBeNull();
  });

  it("premium tier with zero usage returns full budget", async () => {
    mockRpcValues(0, 0);

    const result = await checkTierBudget("user-1", "premium");

    expect(result.allowed).toBe(true);
    expect(result.usedCentsThisMonth).toBe(0);
    expect(result.remainingCents).toBe(TIER_MONTHLY_CAP_CENTS.premium);
  });

  it("throws on monthly RPC error", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "connection refused" },
    });

    await expect(checkTierBudget("user-1", "pro")).rejects.toThrow(
      "Failed to check monthly STT cost: connection refused"
    );
  });

  it("throws on weekly RPC error", async () => {
    mockRpc
      .mockResolvedValueOnce({ data: 0, error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { message: "timeout" },
      });

    await expect(checkTierBudget("user-1", "pro")).rejects.toThrow(
      "Failed to check weekly STT count: timeout"
    );
  });
});
