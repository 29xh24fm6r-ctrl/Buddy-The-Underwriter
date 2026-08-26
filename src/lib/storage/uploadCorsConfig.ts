/**
 * Canonical CORS configuration for the direct-to-storage uploads bucket.
 *
 * Deal documents never pass through Next.js: the browser PUTs the bytes
 * straight to GCS with a V4 signed URL (see `createGcsV4SignedPutUrl`). That
 * PUT always carries `Content-Type` plus the signed
 * `x-goog-content-length-range` header, so it is never a CORS "simple
 * request" — every upload is preceded by a preflight the bucket must answer
 * for the exact browser origin.
 *
 * When the bucket's CORS allowlist does not contain the origin the app is
 * served from, GCS answers the preflight 200 with NO
 * `Access-Control-Allow-Origin` header, the browser cancels the PUT
 * (`net::ERR_FAILED`), and every document in the intake batch fails before a
 * single byte leaves the tab. That is exactly what took doc intake down:
 * the bucket allowed only `https://buddysba.com` / `https://www.buddysba.com`
 * while the authenticated app runs on `https://app.buddytheunderwriter.com`
 * (see APP_ORIGIN in `@/lib/navigation/clerkHosts`).
 *
 * This module is the single source of truth for that allowlist. `cors.json`
 * at the repo root is the artifact applied to the bucket and is generated
 * from here (`pnpm gcs:cors:print`); a guard test fails the build if the two
 * drift apart, so adding a domain to CLERK_MARKETING_HOSTS can no longer
 * silently ship a domain whose uploads are blocked.
 */

import { APP_ORIGIN, CLERK_MARKETING_HOSTS } from "@/lib/navigation/clerkHosts";

/** Local dev origin — Next's default port. */
const LOCAL_DEV_ORIGIN = "http://localhost:3000";

/**
 * Every browser origin that can PUT bytes to the uploads bucket.
 *
 * - APP_ORIGIN: the Clerk-enabled app domain — all banker/internal intake.
 * - CLERK_MARKETING_HOSTS: marketing + borrower surfaces; borrowers upload
 *   from `/portal/[token]` on whichever of these domains their link points at.
 * - localhost: developer machines running `next dev`.
 *
 * Vercel preview deployments (`*.vercel.app`) are intentionally absent: GCS
 * matches origins exactly and has no wildcard-subdomain form, and widening
 * this to `*` on a bucket holding borrower tax returns is not acceptable.
 * Test uploads against a preview by adding that exact preview origin
 * temporarily, or point the preview at a scratch bucket.
 */
export const UPLOAD_BROWSER_ORIGINS: readonly string[] = Object.freeze([
  APP_ORIGIN,
  ...Array.from(CLERK_MARKETING_HOSTS)
    .map((host) => `https://${host}`)
    .sort(),
  LOCAL_DEV_ORIGIN,
]);

/** Methods the browser issues against the bucket. */
export const UPLOAD_CORS_METHODS: readonly string[] = Object.freeze([
  "PUT",
  "GET",
  "HEAD",
]);

/**
 * Headers GCS both allows on the preflight and exposes on the response.
 *
 * `x-goog-content-length-range` is signed into the V4 URL, so the PUT is
 * rejected without it — if it is missing here the preflight fails and the
 * upload never starts.
 */
export const UPLOAD_CORS_RESPONSE_HEADERS: readonly string[] = Object.freeze([
  "Content-Type",
  "x-goog-content-length-range",
  "x-goog-resumable",
]);

export const UPLOAD_CORS_MAX_AGE_SECONDS = 3600;

export type BucketCorsRule = {
  origin: string[];
  method: string[];
  responseHeader: string[];
  maxAgeSeconds: number;
};

/** The exact JSON applied to the bucket (`gcloud storage buckets update --cors-file`). */
export function buildBucketCorsConfig(): BucketCorsRule[] {
  return [
    {
      origin: [...UPLOAD_BROWSER_ORIGINS],
      method: [...UPLOAD_CORS_METHODS],
      responseHeader: [...UPLOAD_CORS_RESPONSE_HEADERS],
      maxAgeSeconds: UPLOAD_CORS_MAX_AGE_SECONDS,
    },
  ];
}

/**
 * True when `rules` (as read back from the bucket or from cors.json) permits
 * `origin` to run the upload preflight. Origin comparison is case-insensitive
 * and ignores a trailing slash, matching GCS behaviour.
 */
export function corsRulesAllowOrigin(
  rules: BucketCorsRule[] | null | undefined,
  origin: string,
): boolean {
  const wanted = normalizeOrigin(origin);
  return (rules ?? []).some((rule) => {
    const origins = (rule.origin ?? []).map(normalizeOrigin);
    if (!origins.includes(wanted) && !origins.includes("*")) return false;
    const methods = (rule.method ?? []).map((m) => m.toUpperCase());
    if (!UPLOAD_CORS_METHODS.every((m) => methods.includes(m))) return false;
    const headers = (rule.responseHeader ?? []).map((h) => h.toLowerCase());
    return UPLOAD_CORS_RESPONSE_HEADERS.every((h) => headers.includes(h.toLowerCase()));
  });
}

function normalizeOrigin(origin: string): string {
  return String(origin).trim().toLowerCase().replace(/\/$/, "");
}
