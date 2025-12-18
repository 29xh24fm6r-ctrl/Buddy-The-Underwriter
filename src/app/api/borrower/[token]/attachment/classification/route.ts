import { NextResponse } from "next/server";
import { requireBorrowerToken } from "@/lib/borrower/token";
import { updateBorrowerAttachmentMeta } from "@/lib/borrowerAttachments/updateAttachmentMeta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const { application } = await requireBorrowerToken(token);
    const body = await req.json();

    const file_key = String(body.file_key ?? "");
    const doc_type = body.doc_type ?? null;
    const tax_year = body.tax_year ?? null;
    const confidence = body.confidence ?? null;
    const reasons = body.reasons ?? null;

    if (!file_key) {
      return NextResponse.json({ ok: false, error: "Missing file_key" }, { status: 400 });
    }

    // Patch shape matches your evaluator expectations:
    // meta.doc_type, meta.tax_year, meta.confidence OR meta.classification.*
    await updateBorrowerAttachmentMeta({
      application_id: application.id,
      file_key,
      patch: {
        doc_type,
        tax_year,
        confidence,
        reasons,
        classification: {
          doc_type,
          tax_year,
          confidence,
          reasons,
        },
      },
    });

    // After meta update, caller can hit requirements recompute.
    // We'll return ok only; UI already calls recompute periodically.
    // (If you want: we can call requirements recompute server-side next sprint.)
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? "classification_write_failed" }, { status: 400 });
  }
}
