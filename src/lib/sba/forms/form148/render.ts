import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import type { Form148BuildResult } from "@/lib/sba/forms/form148/build";

/**
 * SPEC S7 (ARC-00 Phase 5) — fills the official SBA Form 148
 * (`template_key: "SBA_148"`) or 148L (`"SBA_148L"`) PDF depending on the
 * signer's guaranteeType — both already in scripts/ingest-sba-templates.ts's
 * manifest from Phase 0, neither ingested yet (sba.gov blocked). Same
 * fill-or-overlay / never-fabricate contract as every other renderer in
 * this arc.
 *
 * BLOCKED, not fixed: unlike 1919/413/912/4506-C/155, no real copy of
 * this PDF has been supplied (docs/sba-forms/ has no 148-fields.json).
 * Field keys below are still unverified placeholders pending a real
 * source PDF — see docs/sba-forms/TASK-B-ACROFORM-FIELD-VERIFICATION.md §8.
 */

export type RenderForm148Result =
  | { ok: true; pdfBytes: Buffer }
  | { ok: false; reason: "SIGNER_NOT_FOUND" | "TEMPLATE_NOT_AVAILABLE" | "FILL_FAILED"; detail?: string };

export async function renderForm148Pdf(args: {
  supabase: SupabaseClient;
  buildResult: Form148BuildResult;
  ownershipEntityId: string;
}): Promise<RenderForm148Result> {
  const signer = args.buildResult.input.signers.find((s) => s.ownership_entity_id === args.ownershipEntityId);
  if (!signer) {
    return { ok: false, reason: "SIGNER_NOT_FOUND" };
  }

  const templateKey = signer.guaranteeType === "limited" ? "SBA_148L" : "SBA_148";

  const { data: template } = await args.supabase
    .from("bank_document_templates")
    .select("file_path")
    .is("bank_id", null)
    .eq("template_key", templateKey)
    .eq("is_active", true)
    .maybeSingle();

  if (!template?.file_path) {
    return { ok: false, reason: "TEMPLATE_NOT_AVAILABLE" };
  }

  let templateBytes: Buffer;
  try {
    templateBytes = await readFile(path.join(process.cwd(), "public", template.file_path));
  } catch (err: any) {
    return { ok: false, reason: "TEMPLATE_NOT_AVAILABLE", detail: err?.message ?? String(err) };
  }

  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(signer.fields)) {
    if (v != null) values[k] = String(v);
  }

  try {
    const pdfDoc = await PDFDocument.load(templateBytes);
    const form = pdfDoc.getForm();
    const fields = form.getFields();

    if (fields.length > 0) {
      for (const [key, value] of Object.entries(values)) {
        try {
          form.getTextField(key).setText(value);
        } catch {
          // Field name doesn't match this template's AcroForm — expected
          // until real coordinates/names are mapped against the ingested
          // PDF. Skip rather than fail the whole render.
        }
      }
      form.flatten();
    } else {
      const page = pdfDoc.getPage(0);
      const { height } = page.getSize();
      let y = height - 50;
      for (const [key, value] of Object.entries(values)) {
        if (y < 40) break;
        page.drawText(`${key}: ${value}`, { x: 40, y, size: 8 });
        y -= 12;
      }
    }

    const pdfBytes = await pdfDoc.save();
    return { ok: true, pdfBytes: Buffer.from(pdfBytes) };
  } catch (err: any) {
    return { ok: false, reason: "FILL_FAILED", detail: err?.message ?? String(err) };
  }
}
