import { NextResponse } from "next/server";
import { parseGcsServiceAccountJson } from "@/lib/storage/gcs";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const isProd = process.env.NODE_ENV === "production";
    if (isProd) {
      await requireSuperAdmin();
    }

    const creds = parseGcsServiceAccountJson();

    return NextResponse.json({
      ok: true,
      doc_store: process.env.DOC_STORE || null,
      gcs_bucket_set: Boolean(process.env.GCS_BUCKET),
      gcs_creds_parse_ok: creds.ok,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "Unauthorized" },
      { status: 403 },
    );
  }
}
