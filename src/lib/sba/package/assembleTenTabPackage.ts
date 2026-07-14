import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PDFDocument } from "pdf-lib";
import { orderItemsByTab, type PackageRunItemForAssembly } from "@/lib/sba/package/tenTabAssembly";

/**
 * SPEC S7 4 (ARC-00 Phase 5) — downloads every generated item in a
 * package run, merges them into a single PDF in 10-tab order, and uploads
 * the result. Generated items can live in either of two buckets depending
 * on which code path rendered them: `bank-forms` (sbaFormDispatch.ts's
 * own upload, generatePdfForFillRun.ts) or `deal-documents` (Form 159's
 * self-contained upload in compliancePackage.ts/render159.ts — a
 * pre-existing path this arc didn't change). Tries `bank-forms` first,
 * falls back to `deal-documents`, rather than adding a bucket column to
 * `sba_package_run_items` for what is, in practice, exactly one
 * known-different form.
 */

const CANDIDATE_BUCKETS = ["bank-forms", "deal-documents"];
export const OUTPUT_BUCKET = "bank-forms";

export type AssembleTenTabPackageResult =
  | { ok: true; storagePath: string; itemCount: number; missingItems: string[] }
  | { ok: false; reason: "PACKAGE_RUN_NOT_FOUND" | "NO_GENERATED_ITEMS" | "MERGE_FAILED"; detail?: string };

async function downloadFromAnyBucket(supabase: SupabaseClient, storagePath: string): Promise<Buffer | null> {
  for (const bucket of CANDIDATE_BUCKETS) {
    const { data, error } = await supabase.storage.from(bucket).download(storagePath);
    if (!error && data) {
      return Buffer.from(await data.arrayBuffer());
    }
  }
  return null;
}

export async function assembleTenTabPackage(args: {
  supabase: SupabaseClient;
  dealId: string;
  packageRunId: string;
}): Promise<AssembleTenTabPackageResult> {
  const { supabase, dealId, packageRunId } = args;
  const sb = supabase as unknown as { from: (t: string) => any };

  const { data: run } = await sb.from("sba_package_runs").select("id, deal_id").eq("id", packageRunId).maybeSingle();
  if (!run) {
    return { ok: false, reason: "PACKAGE_RUN_NOT_FOUND" };
  }

  const { data: items } = await sb
    .from("sba_package_run_items")
    .select("id, template_code, title, status, output_storage_path, sort_order")
    .eq("package_run_id", packageRunId)
    .order("sort_order", { ascending: true });

  const allItems = (items ?? []) as Array<PackageRunItemForAssembly & { sort_order: number }>;
  const tabbed = orderItemsByTab(allItems);

  if (tabbed.length === 0) {
    return { ok: false, reason: "NO_GENERATED_ITEMS" };
  }

  const missingItems = allItems.filter((it) => it.status !== "generated" || !it.output_storage_path).map((it) => it.template_code);

  try {
    const merged = await PDFDocument.create();

    for (const { item } of tabbed) {
      const bytes = await downloadFromAnyBucket(supabase, item.output_storage_path!);
      if (!bytes) continue; // download failure for one item shouldn't fail the whole assembly
      const sourceDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const copiedPages = await merged.copyPages(sourceDoc, sourceDoc.getPageIndices());
      for (const page of copiedPages) merged.addPage(page);
    }

    const mergedBytes = await merged.save();
    const storagePath = `deals/${dealId}/sba-packages/${packageRunId}/complete-package.pdf`;

    const { error: uploadError } = await supabase.storage.from(OUTPUT_BUCKET).upload(storagePath, mergedBytes, { contentType: "application/pdf", upsert: true });
    if (uploadError) {
      return { ok: false, reason: "MERGE_FAILED", detail: uploadError.message };
    }

    await sb
      .from("sba_package_runs")
      .update({ assembled_package_storage_path: storagePath, assembled_at: new Date().toISOString() })
      .eq("id", packageRunId);

    return { ok: true, storagePath, itemCount: tabbed.length, missingItems };
  } catch (err: any) {
    return { ok: false, reason: "MERGE_FAILED", detail: err?.message ?? String(err) };
  }
}
