import { NextResponse } from "next/server";
import { setDocStatus } from "@/lib/db/docRecords";
import { upsertExtract } from "@/lib/db/extractRecords";
import { extractByDocType } from "@/lib/extract/router/extractByDocType";

export const runtime = "nodejs";

/**
 * POST /api/docs/extract
 * body: { docId: string }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const docId = String(body?.docId ?? "").trim();
    if (!docId) return NextResponse.json({ error: "Missing docId" }, { status: 400 });

    const { doc, result } = await extractByDocType(docId);

    const extract = upsertExtract({
      dealId: doc.dealId,
      docId: doc.id,
      docName: doc.name,
      docType: doc.type,
      fields: result.fields,
      tables: result.tables,
      evidence: result.evidence,
    });

    setDocStatus(doc.id, "REVIEWED");
    return NextResponse.json({ ok: true, doc, extract });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Extraction failed" }, { status: 500 });
  }
}
