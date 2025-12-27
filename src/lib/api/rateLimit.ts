type Bucket = { count: number; resetAt: number };

// VERY simple in-memory limiter (good enough for launch; swap to Upstash/Vercel KV later)
const buckets = new Map<string, Bucket>();

export function rateLimit(opts: {
  key: string;
  limit: number;
  windowMs: number;
}) {
  const now = Date.now();
  const b = buckets.get(opts.key);

  if (!b || now > b.resetAt) {
    buckets.set(opts.key, { count: 1, resetAt: now + opts.windowMs });
    return { ok: true as const, remaining: opts.limit - 1, resetAt: now + opts.windowMs };
  }

  if (b.count >= opts.limit) {
    return { ok: false as const, remaining: 0, resetAt: b.resetAt };
  }

  b.count += 1;
  buckets.set(opts.key, b);
  return { ok: true as const, remaining: opts.limit - b.count, resetAt: b.resetAt };
}
