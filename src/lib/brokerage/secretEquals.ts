import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time secret comparison (audit L6). Avoids the timing side-channel of
 * `a !== b` on shared secrets (CRON_SECRET, gateway secret). Returns false for any
 * null/empty input or length mismatch without leaking length via early timing.
 */
export function secretEquals(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false;
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
