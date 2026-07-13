import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import type { Form912BuildResult } from "@/lib/sba/forms/form912/build";

/**
 * SPEC S4 G-2 — fills the official SBA Form 912 PDF (template_key
 * `SBA_912`, already in scripts/ingest-sba-templates.ts's manifest from
 * Phase 0, not yet ingested — sba.gov blocked). One PDF per triggering
 * person. Same fill-or-overlay / never-fabricate contract as
 * form1919/render.ts and form4506c/render.ts.
 */

export type RenderForm912Result =
  | { ok: true; pdfBytes: Buffer }
  | { ok: false; reason: "NOT_APPLICABLE" | "TEMPLATE_NOT_AVAILABLE" | "PERSON_NOT_FOUND" | "FILL_FAILED"; detail?: string };

export async function renderForm912Pdf(args: {
  supabase: SupabaseClient;
  buildResult: Form912BuildResult;
  ownershipEntityId: string;
}): Promise<RenderForm912Result> {
  const { buildResult } = args;
  if (!buildResult.applicable) {
    return { ok: false, reason: "NOT_APPLICABLE" };
  }

  const person = buildResult.input.persons.find((p) => p.ownership_entity_id === args.ownershipEntityId);
  if (!person) {
    return { ok: false, reason: "PERSON_NOT_FOUND" };
  }

  const { data: template } = await args.supabase
    .from("bank_document_templates")
    .select("file_path")
    .is("bank_id", null)
    .eq("template_key", "SBA_912")
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
  for (const [k, v] of Object.entries(person.fields)) {
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
