/**
 * Resolve the application's base URL for internal server-to-server calls.
 *
 * Priority: NEXT_PUBLIC_APP_URL > NEXT_PUBLIC_SITE_URL > VERCEL_URL
 * Returns null if no URL can be determined (e.g. local dev without env set).
 */
export function getBaseUrl(): string | null {
  if (process.env.NEXT_PUBLIC_APP_URL)
    return process.env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "");

  if (process.env.NEXT_PUBLIC_SITE_URL)
    return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, "");

  if (process.env.VERCEL_URL) {
    const url = process.env.VERCEL_URL;
    return url.startsWith("http") ? url : `https://${url}`;
  }

  return null;
}
