import type { SupabaseClient } from "@supabase/supabase-js";
import { generatePdfBytesFromFillRun } from "@/lib/forms/generatePdfBytesFromFillRun";
import { isDispatchedSbaTemplateCode, renderSbaPackageItem } from "@/lib/sba/package/sbaFormDispatch";

/**
 * SBA Package Builder adapter: Generate PDF and upload to Supabase Storage
 * Used by: POST /api/deals/[dealId]/sba/package/[packageRunId]/generate
 *
 * SPEC S4 H-1 — `template_code`s that ARC-00 built a real form module for
 * (SBA_1919/413/912/155/159, IRS_4506C) are dispatched to that module
 * instead of the legacy generic fillEngine path, which has no field
 * mapping for any of them. See sbaFormDispatch.ts for the full rationale
 * and its documented per-signer-forms simplification.
 */
export async function generatePdfForFillRun(opts: {
  supabase: SupabaseClient;
  dealId: string;
  fillRunId: string;
}): Promise<{ storagePath: string; fileName: string }> {
  const { supabase, dealId, fillRunId } = opts;

  const { data: fillRun } = await supabase.from("fill_runs").select("template_code").eq("id", fillRunId).maybeSingle();
  const templateCode = (fillRun as { template_code?: string } | null)?.template_code ?? null;

  let fileName: string;
  let pdfBytes: Buffer | null = null;
  let storagePath: string | null = null;

  if (templateCode && isDispatchedSbaTemplateCode(templateCode)) {
    const { data: deal } = await supabase.from("deals").select("bank_id").eq("id", dealId).maybeSingle();
    const bankId = (deal as { bank_id?: string } | null)?.bank_id ?? null;
    if (!bankId) throw new Error(`deal_bank_id_not_found: ${dealId}`);

    const dispatched = await renderSbaPackageItem(templateCode, { dealId, bankId, supabase });
    if (!dispatched.ok) {
      throw new Error(`sba_form_dispatch_failed(${templateCode}): ${dispatched.reason}`);
    }
    fileName = `${templateCode}.pdf`;
    if ("storagePath" in dispatched) {
      // Form 159's renderer already uploads to its own bucket/path.
      storagePath = dispatched.storagePath;
    } else {
      pdfBytes = dispatched.pdfBytes;
    }
  } else {
    const generated = await generatePdfBytesFromFillRun({ supabase, dealId, fillRunId });
    fileName = generated.fileName;
    pdfBytes = generated.pdfBytes;
  }

  if (pdfBytes) {
    // NOTE: ensure this bucket exists in Supabase Storage
    const bucket = "bank-forms";
    storagePath = `deals/${dealId}/sba-packages/${fillRunId}/${fileName}`;

    const { error: upErr } = await supabase.storage.from(bucket).upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: true });
    if (upErr) throw new Error(`pdf_upload_failed: ${upErr.message}`);
  }

  if (!storagePath) throw new Error(`generate_produced_no_output: ${fillRunId}`);

  await supabase.from("fill_runs").update({ status: "generated" }).eq("id", fillRunId);

  return { storagePath, fileName };
}
