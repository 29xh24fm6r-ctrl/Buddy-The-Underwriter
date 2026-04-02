import "server-only";

import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { mustBuilderToken } from "@/lib/builder/mustBuilderToken";
import { SURFACE_WIRING_LEDGER, getWiringSummary } from "@/stitch/surface_wiring_ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const root = process.cwd();

function resolveExportsDir(): string {
  const envRoot = process.env.STITCH_EXPORTS_ROOT;
  if (envRoot && fs.existsSync(envRoot)) return envRoot;
  return path.join(root, "stitch_exports");
}

export async function GET(req: Request) {
  mustBuilderToken(req);

  const exportsDir = resolveExportsDir();
  const summary = getWiringSummary();

  const surfaces = SURFACE_WIRING_LEDGER.map((entry) => {
    const exportPath = entry.slug
      ? path.join(exportsDir, entry.slug, "code.html")
      : null;
    const exportExists = exportPath ? fs.existsSync(exportPath) : false;
    const exportSizeKb = exportExists
      ? Math.round(fs.statSync(exportPath!).size / 1024)
      : 0;

    return {
      key: entry.key,
      route: entry.route,
      slug: entry.slug,
      status: entry.status,
      integrationType: entry.integrationType,
      hasActivationScript: entry.hasActivationScript,
      required: entry.required,
      exportExists,
      exportSizeKb,
      dataDependencies: entry.dataDependencies,
      apiCallsExpected: entry.apiCallsExpected,
      writeActionsExpected: entry.writeActionsExpected,
      permissionModel: entry.permissionModel,
      notes: entry.notes,
    };
  });

  return NextResponse.json({
    ok: true,
    summary,
    surfaces,
    exportsDirExists: fs.existsSync(exportsDir),
  });
}
