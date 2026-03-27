import "server-only";

import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { STITCH_SURFACES } from "@/stitch/stitchSurfaceRegistry";
import { mustBuilderToken } from "@/lib/builder/mustBuilderToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const root = process.cwd();
const exportsDir = path.join(root, "stitch_exports");

type SurfaceAuditEntry = {
  key: string;
  route: string;
  slug: string | undefined;
  required: boolean;
  pagePathExists: boolean;
  exportExists: boolean;
  routeRendersStitch: boolean;
  isRecoveryRoute: boolean;
  hasStitchBackup: boolean;
  orphaned: boolean;
};

export async function GET(req: Request) {
  mustBuilderToken(req);

  // ── Audit every registry surface ──────────────────────────
  const surfaces: SurfaceAuditEntry[] = [];

  for (const surface of STITCH_SURFACES) {
    const pagePathExists = surface.pagePath
      ? fs.existsSync(path.resolve(root, surface.pagePath))
      : false;

    const exportExists = surface.slug
      ? fs.existsSync(path.join(exportsDir, surface.slug, "code.html"))
      : false;

    let routeRendersStitch = false;
    if (surface.pagePath && pagePathExists) {
      const content = fs.readFileSync(path.resolve(root, surface.pagePath), "utf8");
      routeRendersStitch = content.includes("StitchSurface");
    }

    const isRecoveryRoute = surface.route.startsWith("/stitch-recovery") || surface.route === "/stitch-login";

    const hasStitchBackup = surface.pagePath
      ? fs.existsSync(path.resolve(root, surface.pagePath + ".stitch-backup"))
      : false;

    surfaces.push({
      key: surface.key,
      route: surface.route,
      slug: surface.slug,
      required: surface.required,
      pagePathExists,
      exportExists,
      routeRendersStitch,
      isRecoveryRoute,
      hasStitchBackup,
      orphaned: false,
    });
  }

  // ── Find orphaned exports (in stitch_exports but not in registry) ──
  const registeredSlugs = new Set(
    STITCH_SURFACES.map((s) => s.slug).filter(Boolean),
  );

  const orphanedExports: string[] = [];
  if (fs.existsSync(exportsDir)) {
    const dirs = fs.readdirSync(exportsDir, { withFileTypes: true });
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      if (!fs.existsSync(path.join(exportsDir, dir.name, "code.html"))) continue;
      if (!registeredSlugs.has(dir.name)) {
        orphanedExports.push(dir.name);
      }
    }
  }

  // ── Find stitch backups not in registry ──
  const orphanedBackups: string[] = [];
  const backupGlobs = [
    "src/app/(app)/deals/page.tsx.stitch-backup",
    "src/app/(app)/deals/new/page.tsx.stitch-backup",
    "src/app/sign-in/[[...sign-in]]/page.tsx.stitch-backup",
  ];
  for (const bp of backupGlobs) {
    if (fs.existsSync(path.resolve(root, bp))) {
      orphanedBackups.push(bp);
    }
  }

  // ── Summary ──
  const missingExports = surfaces.filter((s) => s.required && !s.exportExists);
  const missingWrappers = surfaces.filter((s) => s.required && !s.routeRendersStitch);
  const missingPagePaths = surfaces.filter((s) => s.required && !s.pagePathExists);

  return NextResponse.json({
    ok:
      missingExports.length === 0 &&
      missingWrappers.length === 0 &&
      missingPagePaths.length === 0 &&
      orphanedExports.length === 0,
    total: surfaces.length,
    required: surfaces.filter((s) => s.required).length,
    optional: surfaces.filter((s) => !s.required).length,
    surfaces,
    missingExports: missingExports.map((s) => s.key),
    missingWrappers: missingWrappers.map((s) => s.key),
    missingPagePaths: missingPagePaths.map((s) => s.key),
    orphanedExports,
    orphanedBackups,
  });
}
