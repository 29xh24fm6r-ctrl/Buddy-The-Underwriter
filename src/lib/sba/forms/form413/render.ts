import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import type { Form413BuildResult } from "@/lib/sba/forms/form413/build";

/**
 * SPEC S2 E — fills the official SBA Form 413 PDF, one rendered PDF per
 * signer (each 20%+ owner has their own PFS). Same
 * fill-if-AcroForm/overlay-if-flat/TEMPLATE_NOT_AVAILABLE-if-missing
 * strategy as form1919/render.ts.
 */

export type RenderForm413Result =
  | { ok: true; pdfBytes: Buffer }
  | { ok: false; reason: "TEMPLATE_NOT_AVAILABLE" | "SIGNER_NOT_FOUND" | "FILL_FAILED"; detail?: string };

export async function renderForm413Pdf(args: {
  supabase: SupabaseClient;
  buildResult: Form413BuildResult;
  ownershipEntityId: string;
}): Promise<RenderForm413Result> {
  const signer = args.buildResult.input.signers.find((s) => s.ownership_entity_id === args.ownershipEntityId);
  if (!signer) {
    return { ok: false, reason: "SIGNER_NOT_FOUND" };
  }

  const { data: template } = await args.supabase
    .from("bank_document_templates")
    .select("file_path")
    .is("bank_id", null)
    .eq("template_key", "SBA_413")
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
          // Field name doesn't match this template — expected until real
          // coordinates/names are mapped against the ingested PDF.
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
