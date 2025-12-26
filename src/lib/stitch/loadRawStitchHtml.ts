import fs from "node:fs/promises";
import path from "node:path";

/**
 * Load raw Stitch export HTML for a given slug from stitch_exports/<slug>/...
 * Matches your existing candidates list behavior.
 */
export async function loadRawStitchHtml(slug: string): Promise<string> {
  const root = process.env.STITCH_EXPORTS_ROOT ?? path.join(process.cwd(), "stitch_exports");
  const baseDir = path.join(root, slug);

  const candidates = ["code.html", "index.html", "page.html", "export.html", "Code.html", "Index.html"];

  for (const f of candidates) {
    try {
      const full = await fs.readFile(path.join(baseDir, f), "utf-8");
      if (full && full.trim().length > 0) return full;
    } catch {
      // ignore
    }
  }

  // If you later add a manifest pointer, you can expand this.
  throw new Error(`No Stitch HTML found for slug: ${slug} (looked in ${baseDir})`);
}
