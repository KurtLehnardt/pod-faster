/**
 * Tier-aware STT budget checking.
 *
 * Replaces the old flat 24-hour checkSttBudget with monthly cost caps
 * and per-tier weekly limits for free users.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import type { SubscriptionTier } from "@/types/database.types";

// ── Tier configuration ──────────────────────────────────────

/** Monthly cost cap in cents per tier. */
export const TIER_MONTHLY_CAP_CENTS: Record<SubscriptionTier, number> = {
  free: 335,     // ~$3.35 — roughly 5 min/week at $0.67/min
  pro: 1000,     // $10
  premium: 5000, // $50
};

/** Free tier: max partial clips per ISO week (Mon-Sun). */
export const FREE_TIER_WEEKLY_LIMIT = 1;

/** Free tier: clip duration in seconds. */
export const FREE_TIER_CLIP_SECONDS = 300;

/** Free tier: start offset in seconds (minutes 5-10). */
export const FREE_TIER_CLIP_START_SECONDS = 300;

// ── Public types ────────────────────────────────────────────

export interface TierBudgetResult {
  allowed: boolean;
  reason: string | null;
  usedCentsThisMonth: number;
  remainingCents: number;
  weeklyClipsUsed: number;
}

// ── Budget check ────────────────────────────────────────────

/**
 * Check whether a user's tier allows another transcription.
 *
 * For free tier, also enforces the weekly clip limit.
 * For pro/premium, optionally checks estimatedCostCents against remaining budget.
 */
export async function checkTierBudget(
  userId: string,
  tier: SubscriptionTier,
  estimatedCostCents?: number,
): Promise<TierBudgetResult> {
  const supabase = createAdminClient();
  const monthlyCap = TIER_MONTHLY_CAP_CENTS[tier];

  // Fetch monthly cost via RPC
  const { data: monthlyData, error: monthlyError } = await supabase.rpc(
    "stt_monthly_cost",
    { p_user_id: userId },
  );

  if (monthlyError) {
    throw new Error(`Failed to check monthly STT cost: ${monthlyError.message}`);
  }

  const usedCentsThisMonth = Number(monthlyData ?? 0);
  const remainingCents = Math.max(0, monthlyCap - usedCentsThisMonth);

  // Fetch weekly clip count (needed for free tier, but always returned)
  const { data: weeklyData, error: weeklyError } = await supabase.rpc(
    "stt_weekly_count",
    { p_user_id: userId },
  );

  if (weeklyError) {
    throw new Error(`Failed to check weekly STT count: ${weeklyError.message}`);
  }

  const weeklyClipsUsed = Number(weeklyData ?? 0);

  // Monthly cap check
  if (remainingCents <= 0) {
    return {
      allowed: false,
      reason: `Monthly transcription budget exhausted ($${(monthlyCap / 100).toFixed(2)} cap for ${tier} tier)`,
      usedCentsThisMonth,
      remainingCents: 0,
      weeklyClipsUsed,
    };
  }

  // Free tier: weekly clip limit
  if (tier === "free" && weeklyClipsUsed >= FREE_TIER_WEEKLY_LIMIT) {
    return {
      allowed: false,
      reason: "Free tier allows 1 preview clip per week. Upgrade to Pro for full transcriptions.",
      usedCentsThisMonth,
      remainingCents,
      weeklyClipsUsed,
    };
  }

  // Pre-flight cost check for pro/premium
  if (estimatedCostCents != null && estimatedCostCents > remainingCents) {
    // Allow if remaining budget > 50% of monthly cap (soft cap)
    if (remainingCents > monthlyCap * 0.5) {
      // Soft allow — will deduct actual cost after
      return {
        allowed: true,
        reason: null,
        usedCentsThisMonth,
        remainingCents,
        weeklyClipsUsed,
      };
    }
    return {
      allowed: false,
      reason: `Estimated cost (${estimatedCostCents.toFixed(1)}¢) exceeds remaining budget (${remainingCents.toFixed(1)}¢)`,
      usedCentsThisMonth,
      remainingCents,
      weeklyClipsUsed,
    };
  }

  return {
    allowed: true,
    reason: null,
    usedCentsThisMonth,
    remainingCents,
    weeklyClipsUsed,
  };
}
