import "server-only";

import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { STITCH_SURFACES } from "@/stitch/stitchSurfaceRegistry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const root = process.cwd();

export async function GET() {
  const required = STITCH_SURFACES.filter((s) => s.required);

  const present: string[] = [];
  const missing: Array<{ key: string; reason: string }> = [];

  for (const surface of required) {
    if (!surface.pagePath) {
      missing.push({ key: surface.key, reason: "missing_page_path" });
      continue;
    }

    const absolute = path.resolve(root, surface.pagePath);
    if (!fs.existsSync(absolute)) {
      missing.push({ key: surface.key, reason: "page_path_not_found" });
      continue;
    }

    const content = fs.readFileSync(absolute, "utf8");
    if (content.includes("StitchSurface")) {
      present.push(surface.key);
    } else {
      missing.push({ key: surface.key, reason: "stitch_surface_not_referenced" });
    }
  }

  return NextResponse.json({
    ok: missing.length === 0,
    present,
    missing,
  });
}
