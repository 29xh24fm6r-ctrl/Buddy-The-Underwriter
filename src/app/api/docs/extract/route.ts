import { NextResponse } from "next/server";
import { setDocStatus } from "@/lib/db/docRecords";
import { upsertExtract } from "@/lib/db/extractRecords";
import { extractByDocType } from "@/lib/extract/router/extractByDocType";

export const runtime = "nodejs";

/**
 * POST /api/docs/extract
 * body: { docId: string }
 *
 * Routes to Smart Router for extraction:
 * - Complex docs (tax returns, financials) → Google Document AI
 * - Standard docs (bank statements, etc.) → Gemini OCR
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const docId = String(body?.docId ?? "").trim();
    if (!docId)
      return NextResponse.json({ error: "Missing docId" }, { status: 400 });

    const { doc, result, provider_metrics } = await extractByDocType(docId);

    // Adapt new doc shape to legacy upsertExtract interface
    const extract = upsertExtract({
      dealId: doc.deal_id,
      docId: doc.id,
      docName: doc.original_filename || doc.storage_path,
      docType: doc.type,
      fields: result.fields,
      tables: result.tables,
      evidence: result.evidence,
    });

    // Update legacy in-memory status (if doc exists there)
    setDocStatus(doc.id, "REVIEWED");

    return NextResponse.json({
      ok: true,
      doc,
      extract,
      provider_metrics,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Extraction failed" },
      { status: 500 },
    );
  }
}
