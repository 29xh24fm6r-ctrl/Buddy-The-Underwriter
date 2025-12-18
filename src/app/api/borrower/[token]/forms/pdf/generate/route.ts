import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireBorrowerToken } from "@/lib/borrower/token";
import { SBA_INTAKE_FORM } from "@/lib/forms/registry";
import { mapPdfFields } from "@/lib/forms/fillPdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const { application } = await requireBorrowerToken(token);
    const sb = supabaseAdmin();

    const { data: form, error: formErr } = await (sb as any)
      .from("sba_form_payloads")
      .select("payload")
      .eq("application_id", application.id)
      .single();

    if (formErr || !form) {
      return NextResponse.json({ ok: false, error: "Form payload not found" }, { status: 404 });
    }

    const pdf = await PDFDocument.create();
    const page = pdf.addPage([612, 792]); // Letter size
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);

    const fields = mapPdfFields(form.payload, SBA_INTAKE_FORM);

    // Header
    page.drawText("SBA Intake Form", {
      x: 50,
      y: 750,
      size: 16,
      font: boldFont,
    });

    // Fields
    let y = 720;
    for (const [k, v] of Object.entries(fields)) {
      page.drawText(`${k}: ${v}`, { x: 50, y, size: 11, font });
      y -= 20;
    }

    // Footer
    page.drawText(`Generated: ${new Date().toLocaleString()}`, {
      x: 50,
      y: 30,
      size: 8,
      font,
    });

    const bytes = await pdf.save();
    const path = `applications/${application.id}/forms/intake.pdf`;

    const { error: uploadErr } = await sb.storage
      .from("generated")
      .upload(path, bytes, { upsert: true });

    if (uploadErr) {
      return NextResponse.json({ ok: false, error: `Upload failed: ${uploadErr.message}` }, { status: 500 });
    }

    await (sb as any).from("generated_documents").insert({
      application_id: application.id,
      artifact_type: "PDF_FORM",
      name: "SBA Intake",
      storage_path: path,
      version: "v1",
    });

    return NextResponse.json({ ok: true, path });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "pdf_generation_failed" },
      { status: 500 }
    );
  }
}
