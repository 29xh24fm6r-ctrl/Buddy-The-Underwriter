import { NextResponse } from "next/server";
import { getOcrEnvDiagnostics } from "@/lib/ocr/ocrEnvDiagnostics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health/gemini
 *
 * Public, non-invasive health check.
 * Does NOT call Vertex/Gemini (to avoid cost/abuse); it only reports whether
 * the required runtime configuration appears present.
 */
export async function GET() {
  try {
    const ocr = getOcrEnvDiagnostics();

    const ok =
      ocr.useGeminiOcrEnabled && ocr.hasGoogleProject && ocr.hasGoogleCredentialsHint;

    return NextResponse.json(
      {
        ok,
        ocr,
        hint: ok
          ? "✅ Gemini OCR appears configured (env-only check)."
          : "❌ Gemini OCR is not fully configured. Set USE_GEMINI_OCR=true, GOOGLE_CLOUD_PROJECT, and ADC/WIF env vars (GCP_WIF_PROVIDER, GCP_SERVICE_ACCOUNT_EMAIL, VERCEL_OIDC_TOKEN) or GOOGLE_APPLICATION_CREDENTIALS, then redeploy.",
        timestamp: new Date().toISOString(),
      },
      { status: 200 },
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "healthcheck_failed" },
      { status: 500 },
    );
  }
}
