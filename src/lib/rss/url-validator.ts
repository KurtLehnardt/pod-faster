/**
 * URL validator with SSRF protection for podcast feed URLs.
 *
 * Blocks:
 *  - Non-HTTP(S) schemes
 *  - URLs with embedded credentials (user:pass@)
 *  - Private / reserved IP ranges (RFC 1918, loopback, link-local, etc.)
 *  - IPv6 private ranges (::1, fc00::/7)
 *  - Private/internal hostnames (localhost, *.local, *.internal, 0.0.0.0, [::1])
 *  - URLs exceeding 2048 characters
 *  - DNS rebinding attacks (validates resolved IPs against private ranges)
 */

import dns from "dns/promises";

const MAX_URL_LENGTH = 2048;

/**
 * IPv4 patterns that must be blocked (private, loopback, link-local, unspecified).
 * Each entry is [firstOctet, secondOctetMin?, secondOctetMax?].
 */
function isPrivateIPv4(hostname: string): boolean {
  // Match bare IPv4 addresses like 10.0.0.1 or bracketed [10.0.0.1]
  const ipv4Match = hostname.match(
    /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
  );
  if (!ipv4Match) return false;

  const [, a, b] = ipv4Match.map(Number) as [number, number, number, number, number];

  // 10.0.0.0/8
  if (a === 10) return true;
  // 172.16.0.0/12  (172.16.x.x – 172.31.x.x)
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  // 127.0.0.0/8 (loopback)
  if (a === 127) return true;
  // 169.254.0.0/16 (link-local)
  if (a === 169 && b === 254) return true;
  // 0.0.0.0/8 (unspecified)
  if (a === 0) return true;

  return false;
}

/**
 * Blocked hostnames and hostname suffixes that resolve to private/internal addresses.
 * Checked case-insensitively before IP-based checks.
 */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "0.0.0.0",
  "[::1]",
]);

const BLOCKED_HOSTNAME_SUFFIXES = [
  ".local",
  ".internal",
];

function isBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(lower)) return true;

  for (const suffix of BLOCKED_HOSTNAME_SUFFIXES) {
    if (lower === suffix.slice(1) || lower.endsWith(suffix)) return true;
  }

  return false;
}

function isPrivateIPv6(hostname: string): boolean {
  // Strip brackets if present: [::1] -> ::1
  const raw = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;

  const lower = raw.toLowerCase();

  // ::1 loopback
  if (lower === "::1") return true;

  // fc00::/7 — covers fc00:: through fdff::
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;

  // fe80::/10 — link-local
  if (lower.startsWith("fe80")) return true;

  // :: unspecified
  if (lower === "::") return true;

  return false;
}

export interface UrlValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Detailed URL validation with specific error messages.
 */
export function validateFeedUrl(url: string): UrlValidationResult {
  if (!url || typeof url !== "string") {
    return { valid: false, error: "URL is required" };
  }

  if (url.length > MAX_URL_LENGTH) {
    return {
      valid: false,
      error: `URL exceeds maximum length of ${MAX_URL_LENGTH} characters`,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, error: "Invalid URL format" };
  }

  // Only allow http and https
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      valid: false,
      error: `Scheme "${parsed.protocol.replace(":", "")}" is not allowed. Use http or https.`,
    };
  }

  // Block embedded credentials
  if (parsed.username || parsed.password) {
    return {
      valid: false,
      error: "URLs with embedded credentials are not allowed",
    };
  }

  // Hostname must exist
  if (!parsed.hostname) {
    return { valid: false, error: "URL must have a hostname" };
  }

  // Block known-private hostnames (localhost, *.local, *.internal, etc.)
  if (isBlockedHostname(parsed.hostname)) {
    return { valid: false, error: "URLs pointing to private or internal hostnames are not allowed" };
  }

  // Check private IPv4
  if (isPrivateIPv4(parsed.hostname)) {
    return { valid: false, error: "URLs pointing to private IP addresses are not allowed" };
  }

  // Check private IPv6
  if (isPrivateIPv6(parsed.hostname)) {
    return { valid: false, error: "URLs pointing to private IP addresses are not allowed" };
  }

  return { valid: true };
}

/**
 * Simple boolean check for use in guards / conditionals.
 */
export function isAllowedUrl(url: string): boolean {
  return validateFeedUrl(url).valid;
}

/**
 * Check if an IP address (v4 or v6) is in a private/reserved range.
 * Used by validateResolvedUrl to check DNS-resolved IPs.
 */
function isPrivateIP(ip: string): boolean {
  // IPv4
  if (ip.startsWith("10.") || ip.startsWith("127.") || ip.startsWith("169.254.")) return true;
  if (ip.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (ip === "0.0.0.0") return true;
  // IPv6
  if (ip === "::1") return true;
  const lower = ip.toLowerCase();
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7
  if (lower.startsWith("fe80")) return true; // link-local
  if (lower === "::") return true;
  // IPv4-mapped IPv6 (e.g., ::ffff:127.0.0.1)
  if (lower.startsWith("::ffff:")) {
    const mapped = lower.slice(7);
    return isPrivateIP(mapped);
  }
  return false;
}

/**
 * Validate a URL by resolving its hostname via DNS and checking that
 * all resolved IPs are public. Prevents DNS rebinding attacks where
 * a hostname initially resolves to a public IP but later resolves to
 * a private one.
 *
 * Skips DNS resolution for IP literals (already checked by validateFeedUrl).
 */
export async function validateResolvedUrl(url: string): Promise<void> {
  const hostname = new URL(url).hostname;
  // Skip DNS check for IPv4 literals (already checked by validateFeedUrl)
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return;
  // Skip DNS check for IPv6 literals (bracketed, already checked)
  if (hostname.startsWith("[")) return;

  try {
    const [ipv4s, ipv6s] = await Promise.allSettled([
      dns.resolve4(hostname),
      dns.resolve6(hostname),
    ]);

    const allIps = [
      ...(ipv4s.status === "fulfilled" ? ipv4s.value : []),
      ...(ipv6s.status === "fulfilled" ? ipv6s.value : []),
    ];

    for (const ip of allIps) {
      if (isPrivateIP(ip)) {
        throw new Error(`DNS resolved to private IP: ${ip}`);
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("private IP")) throw err;
    // DNS resolution failure — let the fetch fail naturally
  }
}
