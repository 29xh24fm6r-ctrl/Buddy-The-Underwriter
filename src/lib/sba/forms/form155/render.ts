import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import type { Form155BuildResult } from "@/lib/sba/forms/form155/build";

/**
 * SPEC S4 G-3 — fills the official SBA Form 155 PDF (template_key
 * `SBA_155`, already in scripts/ingest-sba-templates.ts's manifest,
 * not yet ingested — sba.gov blocked). Deal-level, not per-signer (unlike
 * 4506-C/912) — Form 155 has exactly one instance per deal when
 * applicable. Same fill-or-overlay / never-fabricate contract as the rest
 * of this arc's renderers.
 */

export type RenderForm155Result =
  | { ok: true; pdfBytes: Buffer }
  | { ok: false; reason: "NOT_APPLICABLE" | "TEMPLATE_NOT_AVAILABLE" | "FILL_FAILED"; detail?: string };

export async function renderForm155Pdf(args: { supabase: SupabaseClient; buildResult: Form155BuildResult }): Promise<RenderForm155Result> {
  const { buildResult } = args;
  if (!buildResult.applicable) {
    return { ok: false, reason: "NOT_APPLICABLE" };
  }

  const { data: template } = await args.supabase
    .from("bank_document_templates")
    .select("file_path")
    .is("bank_id", null)
    .eq("template_key", "SBA_155")
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
  for (const [k, v] of Object.entries(buildResult.input)) {
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
