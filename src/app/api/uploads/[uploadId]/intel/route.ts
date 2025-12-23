import { NextResponse } from "next/server";
import { runUploadIntel } from "@/lib/intel/run-upload-intel";

export const runtime = "nodejs";

export async function POST(_req: Request, ctx: { params: { uploadId: string } }) {
  try {
    const out = await runUploadIntel(String(ctx.params.uploadId));
    return NextResponse.json(out);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Upload intel failed" }, { status: 500 });
  }
}
