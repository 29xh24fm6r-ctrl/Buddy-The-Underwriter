import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import type { Form4506cBuildResult } from "@/lib/sba/forms/form4506c/build";

/**
 * SPEC S4 D-1 — fills the official IRS Form 4506-C PDF (template_key
 * `IRS_4506C`, registered in scripts/ingest-sba-templates.ts's manifest,
 * not yet ingested in this environment — irs.gov is blocked by this
 * environment's proxy policy). One PDF per signer, since e-signature is
 * requested per signer (mirrors form1919/render.ts's fill-or-overlay
 * fallback and TEMPLATE_NOT_AVAILABLE contract — never fabricate output).
 */

export type RenderForm4506cResult =
  | { ok: true; pdfBytes: Buffer }
  | { ok: false; reason: "TEMPLATE_NOT_AVAILABLE" | "SIGNER_NOT_FOUND" | "FILL_FAILED"; detail?: string };

function flattenFieldValues(result: Form4506cBuildResult, ownershipEntityId: string): Record<string, string> | null {
  const signer = result.input.signers.find((s) => s.ownership_entity_id === ownershipEntityId);
  if (!signer) return null;

  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(signer.fields)) {
    if (v != null) values[k] = String(v);
  }
  for (const [k, v] of Object.entries(result.input.thirdParty)) {
    if (v != null) values[`third_party.${k}`] = String(v);
  }
  return values;
}

export async function renderForm4506cPdf(args: {
  supabase: SupabaseClient;
  buildResult: Form4506cBuildResult;
  ownershipEntityId: string;
}): Promise<RenderForm4506cResult> {
  const values = flattenFieldValues(args.buildResult, args.ownershipEntityId);
  if (!values) {
    return { ok: false, reason: "SIGNER_NOT_FOUND" };
  }

  const { data: template } = await args.supabase
    .from("bank_document_templates")
    .select("file_path")
    .is("bank_id", null)
    .eq("template_key", "IRS_4506C")
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
