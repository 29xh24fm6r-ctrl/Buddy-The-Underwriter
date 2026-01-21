import { NextResponse } from "next/server";
import { ensureGcpAdcBootstrap } from "@/lib/gcpAdcBootstrap";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const isProd = process.env.NODE_ENV === "production";
    if (isProd) {
      await requireSuperAdmin();
    }

    ensureGcpAdcBootstrap();
    const hasWif = Boolean(
      process.env.GCP_WIF_PROVIDER &&
        process.env.GCP_SERVICE_ACCOUNT_EMAIL &&
        process.env.VERCEL_OIDC_TOKEN,
    );
    const hasAdc = Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS || hasWif);

    return NextResponse.json({
      ok: true,
      doc_store: process.env.DOC_STORE || null,
      gcs_bucket_set: Boolean(process.env.GCS_BUCKET),
      gcs_adc_configured: hasAdc,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "Unauthorized" },
      { status: 403 },
    );
  }
}
