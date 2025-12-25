import { NextRequest, NextResponse } from "next/server";
import { runUploadIntel } from "@/lib/intel/run-upload-intel";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ uploadId: string }> },
) {
  const { uploadId } = await ctx.params;
  try {
    const out = await runUploadIntel(String(uploadId));
    return NextResponse.json(out);
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Upload intel failed" },
      { status: 500 },
    );
  }
}
