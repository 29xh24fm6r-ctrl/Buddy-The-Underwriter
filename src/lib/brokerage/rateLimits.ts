import "server-only";

/**
 * Brokerage rate limiter.
 *
 * Multi-tier limits on anonymous endpoints per master plan §3a:
 *   per IP     60s/5     3600s/30    86400s/100
 *   per token  60s/10    3600s/100
 *
 * Fails open — counter outage must not take down the product. Ops
 * monitors for sustained counter failures.
 */

import { headers } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; reason: string; retryAfterSeconds: number };

export async function checkConciergeRateLimit(args: {
  tokenHash: string | null;
}): Promise<RateLimitResult> {
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    h.get("x-real-ip") ??
    "unknown";

  const ipMin = await incrementAndCheck(`rl:ip:${ip}:min`, 60, 5);
  if (!ipMin.allowed)
    return {
      allowed: false,
      reason: "ip_rate_limit_minute",
      retryAfterSeconds: ipMin.retryAfter,
    };

  const ipHour = await incrementAndCheck(`rl:ip:${ip}:hour`, 3600, 30);
  if (!ipHour.allowed)
    return {
      allowed: false,
      reason: "ip_rate_limit_hour",
      retryAfterSeconds: ipHour.retryAfter,
    };

  const ipDay = await incrementAndCheck(`rl:ip:${ip}:day`, 86400, 100);
  if (!ipDay.allowed)
    return {
      allowed: false,
      reason: "ip_rate_limit_day",
      retryAfterSeconds: ipDay.retryAfter,
    };

  if (args.tokenHash) {
    const sessMin = await incrementAndCheck(
      `rl:sess:${args.tokenHash}:min`,
      60,
      10,
    );
    if (!sessMin.allowed)
      return {
        allowed: false,
        reason: "session_rate_limit_minute",
        retryAfterSeconds: sessMin.retryAfter,
      };

    const sessHour = await incrementAndCheck(
      `rl:sess:${args.tokenHash}:hour`,
      3600,
      100,
    );
    if (!sessHour.allowed)
      return {
        allowed: false,
        reason: "session_rate_limit_hour",
        retryAfterSeconds: sessHour.retryAfter,
      };
  }

  return { allowed: true };
}

async function incrementAndCheck(
  key: string,
  windowSeconds: number,
  limit: number,
): Promise<{ allowed: boolean; retryAfter: number }> {
  const sb = supabaseAdmin();
  const windowStart =
    Math.floor(Date.now() / 1000 / windowSeconds) * windowSeconds;
  const windowKey = `${key}:${windowStart}`;

  const { data, error } = await sb.rpc("increment_rate_counter", {
    p_key: windowKey,
    p_expires_at: new Date((windowStart + windowSeconds) * 1000).toISOString(),
  });

  if (error) {
    // Fail open — counter outage must not take down the product.
    console.warn("[rate-limit] counter failed; fail-open:", error.message);
    return { allowed: true, retryAfter: 0 };
  }

  const count = (data as number) ?? 0;
  if (count > limit) {
    const retryAfter =
      windowStart + windowSeconds - Math.floor(Date.now() / 1000);
    return { allowed: false, retryAfter: Math.max(retryAfter, 1) };
  }
  return { allowed: true, retryAfter: 0 };
}

// Exported for unit testing.
export const __test_incrementAndCheck = incrementAndCheck;
