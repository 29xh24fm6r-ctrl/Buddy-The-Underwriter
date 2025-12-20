import type { SupabaseClient } from "@supabase/supabase-js";
import { generatePdfBytesFromFillRun } from "@/lib/forms/generatePdfBytesFromFillRun";

/**
 * SBA Package Builder adapter: Generate PDF and upload to Supabase Storage
 * Used by: POST /api/deals/[dealId]/sba/package/[packageRunId]/generate
 */
export async function generatePdfForFillRun(opts: {
  supabase: SupabaseClient;
  dealId: string;
  fillRunId: string;
}): Promise<{ storagePath: string; fileName: string }> {
  const { supabase, dealId, fillRunId } = opts;

  // 1) Generate bytes via the shared core
  const { fileName, pdfBytes } = await generatePdfBytesFromFillRun({
    supabase,
    dealId,
    fillRunId,
  });

  // 2) Upload to Supabase storage
  // NOTE: ensure this bucket exists in Supabase Storage
  const bucket = "bank-forms";
  const storagePath = `deals/${dealId}/sba-packages/${fillRunId}/${fileName}`;

  const { error: upErr } = await supabase.storage
    .from(bucket)
    .upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: true });

  if (upErr) throw new Error(`pdf_upload_failed: ${upErr.message}`);

  // 3) Mark fill_run generated (optional but recommended)
  await supabase.from("fill_runs").update({ status: "generated" }).eq("id", fillRunId);

  return { storagePath, fileName };
}
