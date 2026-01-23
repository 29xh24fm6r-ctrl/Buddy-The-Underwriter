import { NextRequest, NextResponse } from "next/server";
import { handleCreateUploadSession } from "@/lib/uploads/createUploadSessionApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    return await handleCreateUploadSession(req);
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "upload_session_failed" },
      { status: 500 },
    );
  }
}
