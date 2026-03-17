/**
 * Feature Gate
 *
 * Checks whether a user has access to a premium feature based on their
 * subscription tier. Uses admin client for authoritative tier lookup
 * regardless of request context.
 *
 * NOTE: Tier source will move to Stripe webhook-managed data later.
 * Keep tier resolution encapsulated in this module.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import type { SubscriptionTier } from "@/types/database.types";

const TIER_HIERARCHY: Record<SubscriptionTier, number> = {
  free: 0,
  pro: 1,
  premium: 2,
};

/** Maps feature names to the minimum tier required. */
const FEATURE_TIER_MAP: Record<string, SubscriptionTier> = {
  auto_transcribe: "premium",
};

export interface FeatureAccessResult {
  allowed: boolean;
  requiredTier: SubscriptionTier;
  currentTier: SubscriptionTier;
}

/**
 * Check whether a user has access to a given feature based on their
 * subscription tier.
 */
export async function checkFeatureAccess(
  userId: string,
  feature: string,
): Promise<FeatureAccessResult> {
  const requiredTier = FEATURE_TIER_MAP[feature];
  if (!requiredTier) {
    // Unknown feature — deny by default
    return { allowed: false, requiredTier: "premium", currentTier: "free" };
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("subscription_tier")
    .eq("id", userId)
    .single();

  if (error || !data) {
    console.error(
      `[feature-gate] Failed to fetch tier for user ${userId}:`,
      error,
    );
    return { allowed: false, requiredTier, currentTier: "free" };
  }

  const currentTier = data.subscription_tier ?? "free";
  const allowed =
    TIER_HIERARCHY[currentTier] >= TIER_HIERARCHY[requiredTier];

  return { allowed, requiredTier, currentTier };
}
