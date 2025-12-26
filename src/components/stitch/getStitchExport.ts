import { promises as fs } from "fs";
import path from "path";

export type StitchExport = {
  slug: string;
  tailwindCdnSrc: string;
  tailwindConfigJs?: string;
  fontLinks?: string[];
  styles?: string[];
  bodyHtml: string;
};

// Reads stitch_exports/<slug>/index.json or index.html + metadata.
// Your repo already has a stitch export loader somewhere; this is a minimal safe fallback.
// If you already have a canonical loader, replace this file with that import.
async function tryLoadSlug(slug: string): Promise<StitchExport | null> {
  const base = path.join(process.cwd(), "stitch_exports", slug);

  // Preferred: index.json (if you already generate it)
  try {
    const jsonPath = path.join(base, "index.json");
    const raw = await fs.readFile(jsonPath, "utf-8");
    const j = JSON.parse(raw);

    if (j?.bodyHtml && j?.tailwindCdnSrc) {
      return {
        slug,
        tailwindCdnSrc: j.tailwindCdnSrc,
        tailwindConfigJs: j.tailwindConfigJs,
        fontLinks: j.fontLinks,
        styles: j.styles,
        bodyHtml: j.bodyHtml,
      };
    }
  } catch {}

  // Fallback: index.html only (embed as bodyHtml)
  try {
    const htmlPath = path.join(base, "index.html");
    const html = await fs.readFile(htmlPath, "utf-8");

    // Minimal defaults (tweak if needed)
    return {
      slug,
      tailwindCdnSrc: "https://cdn.tailwindcss.com",
      bodyHtml: html,
    };
  } catch {}

  return null;
}

export async function getStitchExport(slugCandidates: string[]): Promise<StitchExport | null> {
  for (const slug of slugCandidates) {
    const hit = await tryLoadSlug(slug);
    if (hit) return hit;
  }
  return null;
}
