import "server-only";

import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { STITCH_SURFACES } from "@/stitch/stitchSurfaceRegistry";
import { mustBuilderToken } from "@/lib/builder/mustBuilderToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const root = process.cwd();

function resolveExportsDir(): string {
  // Check STITCH_EXPORTS_ROOT env first, then cwd-relative
  const envRoot = process.env.STITCH_EXPORTS_ROOT;
  if (envRoot && fs.existsSync(envRoot)) return envRoot;
  return path.join(root, "stitch_exports");
}

type SurfaceAuditEntry = {
  key: string;
  route: string;
  slug: string | undefined;
  required: boolean;
  mode: string;
  pagePathExists: boolean;
  exportExists: boolean;
  routeRendersStitch: boolean;
  isRecoveryRoute: boolean;
  hasStitchBackup: boolean;
  fallbackDetected: boolean;
  status: "ok" | "missing_page" | "missing_export" | "native_fallback" | "route_not_mapped" | "broken";
};

export async function GET(req: Request) {
  mustBuilderToken(req);

  const exportsDir = resolveExportsDir();
  const exportsDirExists = fs.existsSync(exportsDir);

  // ── Audit every registry surface ──────────────────────────
  const surfaces: SurfaceAuditEntry[] = [];

  for (const surface of STITCH_SURFACES) {
    const pagePathExists = surface.pagePath
      ? fs.existsSync(path.resolve(root, surface.pagePath))
      : false;

    const exportExists = surface.slug && exportsDirExists
      ? fs.existsSync(path.join(exportsDir, surface.slug, "code.html"))
      : false;

    let routeRendersStitch = false;
    let fallbackDetected = false;
    if (surface.pagePath && pagePathExists) {
      const content = fs.readFileSync(path.resolve(root, surface.pagePath), "utf8");
      routeRendersStitch = content.includes("StitchSurface");
      // Detect if route still renders native table shell instead of StitchSurface
      fallbackDetected = !routeRendersStitch && (
        content.includes("listDealsForBank") ||
        content.includes("GlassShell") ||
        content.includes("GlassPageHeader")
      );
    }

    const isRecoveryRoute = surface.route.startsWith("/stitch-recovery") || surface.route === "/stitch-login";

    const hasStitchBackup = surface.pagePath
      ? fs.existsSync(path.resolve(root, surface.pagePath + ".stitch-backup"))
      : false;

    // Determine status
    let status: SurfaceAuditEntry["status"] = "ok";
    if (!surface.pagePath) {
      status = "route_not_mapped";
    } else if (!pagePathExists) {
      status = "missing_page";
    } else if (!routeRendersStitch) {
      status = fallbackDetected ? "native_fallback" : "broken";
    } else if (surface.required && !exportExists && surface.slug !== "underwrite" && surface.slug !== "deal-summary") {
      status = "missing_export";
    }

    surfaces.push({
      key: surface.key,
      route: surface.route,
      slug: surface.slug,
      required: surface.required,
      mode: surface.mode,
      pagePathExists,
      exportExists,
      routeRendersStitch,
      isRecoveryRoute,
      hasStitchBackup,
      fallbackDetected,
      status,
    });
  }

  // ── Find orphaned exports (in stitch_exports but not in registry) ──
  const registeredSlugs = new Set(
    STITCH_SURFACES.map((s) => s.slug).filter(Boolean),
  );

  const orphanedExports: string[] = [];
  if (exportsDirExists) {
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

  // ── Runtime check: can we actually load stitch HTML? ──
  const runtimeCheck = {
    exportsDirExists,
    exportsDirPath: exportsDir,
    sampleSlugLoadable: false,
    sampleSlug: "pipeline-analytics-command-center",
  };
  try {
    const samplePath = path.join(exportsDir, runtimeCheck.sampleSlug, "code.html");
    if (fs.existsSync(samplePath)) {
      const content = fs.readFileSync(samplePath, "utf8");
      runtimeCheck.sampleSlugLoadable = content.length > 100;
    }
  } catch {
    // ignore
  }

  // ── Summary ──
  const required = surfaces.filter((s) => s.required);
  const missingExports = required.filter((s) => s.status === "missing_export");
  const missingPages = required.filter((s) => s.status === "missing_page");
  const nativeFallbacks = required.filter((s) => s.status === "native_fallback");
  const broken = required.filter((s) => s.status === "broken");

  return NextResponse.json({
    ok:
      missingExports.length === 0 &&
      missingPages.length === 0 &&
      nativeFallbacks.length === 0 &&
      broken.length === 0 &&
      orphanedExports.length === 0 &&
      runtimeCheck.exportsDirExists,
    total: surfaces.length,
    required: required.length,
    optional: surfaces.length - required.length,
    surfaces,
    missingExports: missingExports.map((s) => s.key),
    missingPages: missingPages.map((s) => s.key),
    nativeFallbacks: nativeFallbacks.map((s) => s.key),
    broken: broken.map((s) => s.key),
    orphanedExports,
    orphanedBackups,
    runtimeCheck,
  });
}
