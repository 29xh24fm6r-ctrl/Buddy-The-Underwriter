import { NextRequest, NextResponse } from "next/server";
import { handleCreateUploadSession } from "@/lib/uploads/createUploadSessionApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Detect WIF / STS configuration errors that should surface as 400, not 500. */
function isWifConfigError(msg: string): boolean {
  const patterns = [
    "Invalid WIF provider format",
    "Invalid value for audience",
    "Missing Workload Identity",
    "missing_gcp_config",
    "WIF_AUDIENCE_INVALID",
  ];
  return patterns.some((p) => msg.includes(p));
}

export async function POST(req: NextRequest) {
  try {
    return await handleCreateUploadSession(req);
  } catch (error: any) {
    const msg = String(error?.message || "upload_session_failed");

    if (isWifConfigError(msg)) {
      return NextResponse.json(
        {
          ok: false,
          code: "WIF_AUDIENCE_INVALID",
          message: "Google Workload Identity Provider is misconfigured. Contact support.",
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { ok: false, error: msg },
      { status: 500 },
    );
  }
}
