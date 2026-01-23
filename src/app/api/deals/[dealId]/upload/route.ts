import { NextRequest, NextResponse } from "next/server";
import { handleCreateUploadSession } from "@/lib/uploads/createUploadSessionApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  try {
    const { dealId } = await ctx.params;
    return await handleCreateUploadSession(req, { dealIdOverride: dealId });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "upload_session_failed" },
      { status: 500 },
    );
  }
}
