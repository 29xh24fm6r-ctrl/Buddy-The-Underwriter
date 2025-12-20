// src/app/api/deals/[dealId]/docs/intel/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { analyzeDocument } from "@/lib/docIntel/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  fileId: z.string().uuid(),
  extractedText: z.string().min(1),
});

export async function POST(req: Request, ctx: { params: Promise<{ dealId: string }> }) {
  try {
    const { dealId } = await ctx.params;
    const body = BodySchema.parse(await req.json());
    const out = await analyzeDocument({
      dealId,
      fileId: body.fileId,
      extractedText: body.extractedText,
    });
    return NextResponse.json({ ok: true, result: out });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "doc intel failed" }, { status: 500 });
  }
}
