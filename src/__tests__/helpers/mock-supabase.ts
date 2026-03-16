/**
 * Shared Supabase mock helpers for unit and integration tests.
 *
 * Provides a chainable query-builder mock that mirrors the Supabase JS client.
 * Each `createChain()` call returns an isolated chain with its own `vi.fn()`
 * instances, preventing cross-test interference.
 *
 * Usage:
 *
 *   import { createChain, createMockSupabaseClient } from "@/__tests__/helpers/mock-supabase";
 *
 *   const mockGetUser = vi.fn();
 *   const mockFrom = vi.fn(() => createChain());
 *
 *   vi.mock("@/lib/supabase/server", () => ({
 *     createClient: vi.fn(() =>
 *       Promise.resolve({
 *         auth: { getUser: mockGetUser },
 *         from: mockFrom,
 *       })
 *     ),
 *   }));
 *
 * Or use the convenience factory:
 *
 *   const { mockFrom, mockGetUser, mockSupabase } = createMockSupabaseClient();
 *
 *   vi.mock("@/lib/supabase/server", () => ({
 *     createClient: vi.fn(() => Promise.resolve(mockSupabase)),
 *   }));
 */

import { vi } from "vitest";

/**
 * All query-builder methods supported by the mock chain.
 * Each method returns the chain itself by default (fluent API).
 */
const CHAIN_METHODS = [
  "select",
  "insert",
  "update",
  "delete",
  "eq",
  "in",
  "gte",
  "lte",
  "gt",
  "lt",
  "not",
  "neq",
  "is",
  "order",
  "limit",
  "range",
  "single",
  "maybeSingle",
  "upsert",
] as const;

export type ChainMethod = (typeof CHAIN_METHODS)[number];

export type MockChain = Record<ChainMethod, ReturnType<typeof vi.fn>>;

/**
 * Creates an isolated Supabase query-builder chain where every method
 * returns the same chain object by default. Each chain has its OWN set of
 * `vi.fn()` instances so separate chains never interfere with each other.
 *
 * Override any terminal method with `.mockResolvedValue()` or
 * `.mockReturnValue()` to control what the query resolves to.
 *
 * @example
 *   mockFrom.mockImplementationOnce(() => {
 *     const chain = createChain();
 *     chain.single.mockResolvedValue({ data: myData, error: null });
 *     return chain;
 *   });
 */
export function createChain(): MockChain {
  const chain = {} as MockChain;

  for (const m of CHAIN_METHODS) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }

  return chain;
}

/**
 * Convenience factory that creates a complete mock Supabase client object
 * with `auth.getUser` and `from` pre-wired.
 *
 * Returns the individual mock functions for direct manipulation in tests.
 */
export function createMockSupabaseClient() {
  const mockGetUser = vi.fn();
  const mockFrom = vi.fn(() => createChain());

  const mockSupabase = {
    auth: { getUser: mockGetUser },
    from: mockFrom,
  };

  return { mockGetUser, mockFrom, mockSupabase };
}

/**
 * Helper: configure `mockGetUser` to return an authenticated user.
 */
export function mockAuthUser(
  mockGetUser: ReturnType<typeof vi.fn>,
  id = "user-123",
) {
  mockGetUser.mockResolvedValue({ data: { user: { id } } });
}

/**
 * Helper: configure `mockGetUser` to return no user (unauthenticated).
 */
export function mockNoAuth(mockGetUser: ReturnType<typeof vi.fn>) {
  mockGetUser.mockResolvedValue({ data: { user: null } });
}
