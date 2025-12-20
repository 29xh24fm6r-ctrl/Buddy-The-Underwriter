// src/lib/portal/ratelimit.ts
type Bucket = { resetAt: number; count: number };

const buckets = new Map<string, Bucket>();

/**
 * Simple in-memory rate limiter:
 * - good for V1
 * - can upgrade to Redis later
 */
export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const b = buckets.get(key);

  if (!b || b.resetAt <= now) {
    buckets.set(key, { resetAt: now + windowMs, count: 1 });
    return { ok: true, remaining: limit - 1 };
  }

  if (b.count >= limit) return { ok: false, remaining: 0, resetAt: b.resetAt };

  b.count += 1;
  buckets.set(key, b);
  return { ok: true, remaining: limit - b.count };
}
