import { unstable_cache } from "next/cache";

/**
 * Implementations you already have somewhere:
 * - loadRawStitchHtml(slug): returns the raw HTML string for a stitch export/page
 * - stripStitchChrome(rawHtml): returns stripped HTML string (cheerio)
 *
 * We'll import them below once you point to the right modules.
 */

// TODO: update these imports to match your codebase.
import { loadRawStitchHtml } from "@/lib/stitch/loadRawStitchHtml";
import { stripStitchChrome } from "@/lib/stitch/stripStitchChrome";

const REVALIDATE_SECONDS = Number(process.env.STITCH_REVALIDATE_SECONDS ?? "3600"); // 1 hour
const CACHE_BUST = process.env.STITCH_CACHE_BUST ?? "v1";

/**
 * Returns stripped HTML for a given stitch slug, cached in Next's Data Cache.
 * Key includes CACHE_BUST so you can invalidate instantly by changing env var.
 */
export async function getStrippedStitchHtml(slug: string): Promise<string> {
  const cached = unstable_cache(
    async () => {
      const raw = await loadRawStitchHtml(slug);
      return stripStitchChrome(raw);
    },
    // cache key parts
    ["stitch-stripped-html", slug, CACHE_BUST],
    // cache options
    { revalidate: REVALIDATE_SECONDS }
  );

  return cached();
}
