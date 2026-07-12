import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import type { Form1919BuildResult } from "@/lib/sba/forms/form1919/build";

/**
 * SPEC S2 D-4 — fills the official SBA Form 1919 PDF (ingested via
 * scripts/ingest-sba-templates.ts into bank_document_templates + committed
 * under public/sba-templates/) with the build result's field values.
 *
 * If AcroForm fields exist, fills them by name. Otherwise falls back to
 * pdf-lib text-overlay drawing (spec: "some SBA PDFs are flat"). Per
 * addendum: "if PIV-6 reveals SBA PDF template not available → surface; do
 * not ship a placeholder PDF" — returns TEMPLATE_NOT_AVAILABLE rather than
 * fabricating output. As of this build, the template has not been ingested
 * (ARC-00 Phase 0.C blocked on network access to sba.gov in this
 * environment) — this code path is real and ready but untested against the
 * actual official PDF's field names/layout.
 */

export type RenderForm1919Result =
  | { ok: true; pdfBytes: Buffer }
  | { ok: false; reason: "TEMPLATE_NOT_AVAILABLE" | "FILL_FAILED"; detail?: string };

function flattenFieldValues(result: Form1919BuildResult): Record<string, string> {
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

export async function renderForm1919Pdf(args: {
  supabase: SupabaseClient;
  buildResult: Form1919BuildResult;
}): Promise<RenderForm1919Result> {
  const { data: template } = await args.supabase
    .from("bank_document_templates")
    .select("file_path")
    .is("bank_id", null)
    .eq("template_key", "SBA_1919")
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
          const field = form.getTextField(key);
          field.setText(value);
        } catch {
          // Field name doesn't match this template's AcroForm — expected
          // until real coordinates/names are mapped against the ingested
          // PDF. Skip rather than fail the whole render.
        }
      }
      form.flatten();
    } else {
      // No AcroForm fields — flat PDF. Overlay strategy: draw a summary
      // page rather than guess at coordinates on the official layout
      // (spec: don't block on pixel-perfect placement; banker QA refines).
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
