export type StitchNavHit = {
  href?: string;
  id?: string;
  route?: string;
  text?: string;
};

/**
 * Find the nearest link-like element and extract a route-ish string.
 * Stitch exports vary, so this is intentionally permissive.
 */
export function getStitchNavHit(target: EventTarget | null): StitchNavHit | null {
  const el = (target as Element | null)?.closest?.(
    'a[href], [data-stitch-href], [data-route], [data-nav], [role="link"]'
  );
  if (!el) return null;

  const href =
    (el as HTMLAnchorElement).getAttribute?.("href") ??
    el.getAttribute?.("data-stitch-href") ??
    el.getAttribute?.("data-route") ??
    el.getAttribute?.("data-nav") ??
    undefined;

  return {
    href,
    id: el.getAttribute?.("id") ?? undefined,
    route: href,
    text: (el.textContent ?? "").trim() || undefined,
  };
}

/**
 * Map a StitchNavHit into an app route.
 * Expand this mapping as you add more pages.
 */
export function resolveStitchRoute(hit: StitchNavHit | null): string | null {
  if (!hit) return null;
  const raw = (hit.route || hit.href || "").trim();
  if (!raw) return null;

  // Ignore external links/mailto/etc
  if (/^(https?:)?\/\//i.test(raw)) return null;
  if (/^(mailto:|tel:|#)/i.test(raw)) return null;

  // Normalize common Stitch patterns
  const v = raw.replace(/\/+$/, "");

  // Already an internal absolute path
  if (v.startsWith("/")) return v;

  // Basic slug -> route mapping
  const key = v.toLowerCase();

  const map: Record<string, string> = {
    "deals": "/deals",
    "deal": "/deals",
    "command-center": "/deals",
    "home": "/",
    "dashboard": "/",
  };

  return map[key] ?? null;
}
