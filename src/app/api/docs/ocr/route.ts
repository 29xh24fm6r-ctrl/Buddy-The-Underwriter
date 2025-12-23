import { NextResponse } from "next/server";
import { upsertAzureOcr } from "@/lib/db/ocrRecords";
import { getDocument } from "@/lib/db/docRecords";

export const runtime = "nodejs";

/**
 * POST /api/docs/ocr
 * body: { docId: string, azureOcrJson: any }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const docId = String(body?.docId ?? "").trim();
    if (!docId) return NextResponse.json({ error: "Missing docId" }, { status: 400 });

    const doc = getDocument(docId);
    if (!doc) return NextResponse.json({ error: "Doc not found" }, { status: 404 });

    const payload = body?.azureOcrJson;
    if (!payload) return NextResponse.json({ error: "Missing azureOcrJson" }, { status: 400 });

    const rec = upsertAzureOcr(docId, payload);
    return NextResponse.json({ ok: true, ocr: { docId: rec.docId, provider: rec.provider, createdAt: rec.createdAt } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "OCR attach failed" }, { status: 500 });
  }
}
