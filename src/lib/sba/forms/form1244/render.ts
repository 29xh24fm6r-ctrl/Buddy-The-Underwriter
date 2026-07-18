import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import type { Form1244BuildResult } from "@/lib/sba/forms/form1244/build";

/**
 * SPEC S6 (ARC-00 Phase 4) — fills the official SBA Form 1244 PDF
 * (template_key `SBA_1244`, already in scripts/ingest-sba-templates.ts's
 * manifest from Phase 0, not yet ingested — sba.gov blocked). Same
 * fill-or-overlay / never-fabricate contract as form1919/render.ts.
 *
 * BLOCKED, not fixed: unlike 1919/413/912/4506-C/155, no real copy of
 * this PDF has been supplied (docs/sba-forms/ has no 1244-fields.json).
 * Section II's fields were extended to match the real 1919/1244 data
 * model (see inputBuilder.ts), but the AcroForm field names/types below
 * remain unverified placeholders pending a real source PDF — see
 * docs/sba-forms/TASK-B-ACROFORM-FIELD-VERIFICATION.md §8.
 */

export type RenderForm1244Result =
  | { ok: true; pdfBytes: Buffer }
  | { ok: false; reason: "TEMPLATE_NOT_AVAILABLE" | "FILL_FAILED"; detail?: string };

function flattenFieldValues(result: Form1244BuildResult): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(result.input.sectionI)) {
    if (v != null) values[`section_i.${k}`] = String(v);
  }
  result.input.sectionII.forEach((person, i) => {
    for (const [k, v] of Object.entries(person.fields)) {
      if (v != null) values[`section_ii.${i}.${k}`] = String(v);
    }
  });
  result.input.sectionIII.forEach((entity, i) => {
    for (const [k, v] of Object.entries(entity.fields)) {
      if (v != null) values[`section_iii.${i}.${k}`] = String(v);
    }
  });
  return values;
}

export async function renderForm1244Pdf(args: {
  supabase: SupabaseClient;
  buildResult: Form1244BuildResult;
}): Promise<RenderForm1244Result> {
  const { data: template } = await args.supabase
    .from("bank_document_templates")
    .select("file_path")
    .is("bank_id", null)
    .eq("template_key", "SBA_1244")
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

  const values = flattenFieldValues(args.buildResult);

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
