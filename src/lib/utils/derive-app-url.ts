/**
 * Derive the application base URL from the current request.
 *
 * Fallback chain (first match wins):
 *   1. `x-forwarded-proto` + `host` request headers — the most reliable
 *      source at runtime because they reflect the actual request origin.
 *   2. An explicit `fallbackOrigin` parameter (e.g. `request.nextUrl.origin`).
 *   3. The `NEXT_PUBLIC_APP_URL` environment variable — note this is baked at
 *      build time and may still contain `localhost` in production if the build
 *      ran locally or during CI.
 *   4. Hardcoded production URL as a last resort.
 *
 * Headers take priority over the env var because `NEXT_PUBLIC_APP_URL` is
 * inlined at build time. When the build happens in CI or on a developer
 * machine the value is often `http://localhost:3000`, which is wrong for
 * production requests routed through Vercel.
 */
export function deriveAppUrl(headers: Headers, fallbackOrigin?: string): string {
  const proto = headers.get("x-forwarded-proto");
  const host = headers.get("host");

  if (proto && host) {
    return `${proto}://${host}`;
  }

  if (fallbackOrigin) {
    return fallbackOrigin;
  }

  return process.env.NEXT_PUBLIC_APP_URL || "https://pod-faster.vercel.app";
}
