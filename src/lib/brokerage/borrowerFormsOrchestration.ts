/**
 * Per-owner SBA form generation for Brokerage borrowers — surfaced as a
 * follow-up during Ticket 2 (identity/e-sign): Brokerage had no path to
 * generate the actual filled SBA forms (1919, 413, 912, 4506-C, etc.) that
 * feed the lender-facing 10-tab package, unlike the Underwriter tenant
 * (ARC-00's `sbaFormDispatch.ts`/`sba_package_runs` pipeline).
 *
 * `prepareSbaPackage`/`generatePdfForFillRun`/`assembleTenTabPackage` are
 * already pure functions of (dealId, bankId, supabase) with no Clerk/
 * banker assumptions — this module is the reusable orchestration layer a
 * Brokerage-authed route calls into, mirroring the banker-console actions
 * in /api/deals/[dealId]/sba/route.ts (preparePackageRunAction,
 * generatePackageRunPdfAction, assemblePackageAction) but resolving "the
 * deal's package run" server-side (most recent by created_at) instead of
 * trusting a client-supplied packageRunId — a Brokerage borrower has no
 * reason to know or pass that id, and deriving it server-side closes off
 * the cross-deal-guessing risk the other Brokerage routes guard against.
 *
 * Kept free of "server-only" so it stays testable under plain
 * `node --test`, same pattern as sealingGate.ts/identityVerificationGate.ts.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { prepareSbaPackage } from "@/lib/sba/package/buildPackage";
import { generatePdfForFillRun } from "@/lib/forms/pdfFill/generatePdfForFillRun";
import { assembleTenTabPackage } from "@/lib/sba/package/assembleTenTabPackage";

export type SbaProduct = "7a" | "504" | "express";

/**
 * `deals.product_type` uses distinct values (SBA_7A/SBA_504/SBA_EXPRESS)
 * from `sba_package_templates.code`'s product-keyed applicability rules
 * (7a/504/express) — this is the one place that maps between them.
 * Brokerage is 7(a)-only in practice today (no 504 Brokerage flow has been
 * built), so anything unrecognized or unset defaults to 7(a) rather than
 * failing closed with no package at all.
 */
export function resolveSbaPackageTemplate(productType: string | null | undefined): {
  packageTemplateCode: string;
  product: SbaProduct;
} {
  if (productType === "SBA_504") return { packageTemplateCode: "SBA_504_BASE", product: "504" };
  return { packageTemplateCode: "SBA_7A_BASE", product: "7a" };
}

export type PrepareFormsResult =
  | { ok: true; packageRunId: string; itemCount: number; reused: boolean }
  | { ok: false; reason: "DEAL_NOT_FOUND" };

export async function prepareBrokerageSbaForms(
  dealId: string,
  sb: SupabaseClient,
): Promise<PrepareFormsResult> {
  // Idempotent — a repeated borrower click (or a retry after a network
  // blip) must not spawn a second, divergent package run for the same deal.
  const existing = await resolveCurrentPackageRun(dealId, sb);
  if (existing) {
    const { count } = await sb
      .from("sba_package_run_items")
      .select("id", { count: "exact", head: true })
      .eq("package_run_id", existing.id);
    return { ok: true, packageRunId: existing.id, itemCount: count ?? 0, reused: true };
  }

  const { data: deal } = await sb.from("deals").select("product_type").eq("id", dealId).maybeSingle();
  if (!deal) return { ok: false, reason: "DEAL_NOT_FOUND" };

  const { packageTemplateCode, product } = resolveSbaPackageTemplate(
    (deal as { product_type?: string | null }).product_type,
  );

  const result = await prepareSbaPackage({
    supabase: sb,
    dealId,
    packageTemplateCode,
    product,
    answers: {},
    borrowerData: null,
  });

  return { ok: true, packageRunId: result.packageRunId!, itemCount: result.itemCount, reused: false };
}

async function resolveCurrentPackageRun(
  dealId: string,
  sb: SupabaseClient,
): Promise<{ id: string; status: string } | null> {
  const { data } = await sb
    .from("sba_package_runs")
    .select("id, status")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { id: string; status: string } | null) ?? null;
}

export type FormsStatusResult =
  | { ok: true; packageRun: { id: string; status: string } | null; items: BrokerageFormItem[] }
  | { ok: false; reason: "NO_PACKAGE_RUN" };

export type BrokerageFormItem = {
  id: string;
  templateCode: string;
  title: string;
  required: boolean;
  status: string;
  fillRunId: string | null;
  outputStoragePath: string | null;
  error: string | null;
};

export async function getBrokerageFormsStatus(dealId: string, sb: SupabaseClient): Promise<FormsStatusResult> {
  const run = await resolveCurrentPackageRun(dealId, sb);
  if (!run) return { ok: false, reason: "NO_PACKAGE_RUN" };

  const { data: items } = await sb
    .from("sba_package_run_items")
    .select("id, template_code, title, required, status, fill_run_id, output_storage_path, error")
    .eq("package_run_id", run.id)
    .order("sort_order", { ascending: true });

  return {
    ok: true,
    packageRun: run,
    items: ((items ?? []) as Array<Record<string, any>>).map((it) => ({
      id: it.id,
      templateCode: it.template_code,
      title: it.title,
      required: it.required,
      status: it.status,
      fillRunId: it.fill_run_id,
      outputStoragePath: it.output_storage_path,
      error: it.error,
    })),
  };
}

export type GenerateFormItemResult = {
  itemId: string;
  ok: boolean;
  storagePath?: string;
  fileName?: string;
  error?: string;
};

export type GenerateFormsResult =
  | { ok: true; results: GenerateFormItemResult[] }
  | { ok: false; reason: "NO_PACKAGE_RUN" | "ITEM_NOT_FOUND" };

/**
 * Generates the PDF for one item (`onlyItemId`) or every ungenerated item
 * in the deal's current package run. Mirrors generatePackageRunPdfAction's
 * per-item try/catch-and-record-failure loop in
 * /api/deals/[dealId]/sba/route.ts, minus the client-supplied
 * packageRunId — resolved server-side from dealId instead.
 */
export async function generateBrokerageForms(
  dealId: string,
  sb: SupabaseClient,
  opts?: { onlyItemId?: string },
): Promise<GenerateFormsResult> {
  const run = await resolveCurrentPackageRun(dealId, sb);
  if (!run) return { ok: false, reason: "NO_PACKAGE_RUN" };

  const { data: items } = await sb
    .from("sba_package_run_items")
    .select("id, template_code, fill_run_id")
    .eq("package_run_id", run.id);

  const list = ((items ?? []) as Array<Record<string, any>>).filter(
    (it) => !opts?.onlyItemId || it.id === opts.onlyItemId,
  );
  if (opts?.onlyItemId && list.length === 0) {
    return { ok: false, reason: "ITEM_NOT_FOUND" };
  }

  const results: GenerateFormItemResult[] = [];

  for (const it of list) {
    const fillRunId = it.fill_run_id as string | null;
    if (!fillRunId) {
      await sb.from("sba_package_run_items").update({ status: "failed", error: "Missing fill_run_id" }).eq("id", it.id);
      results.push({ itemId: it.id, ok: false, error: "Missing fill_run_id" });
      continue;
    }

    try {
      const out = await generatePdfForFillRun({ supabase: sb, dealId, fillRunId });
      await sb
        .from("sba_package_run_items")
        .update({
          status: "generated",
          output_storage_path: out.storagePath ?? null,
          output_file_name: out.fileName ?? `${it.template_code}.pdf`,
          error: null,
        })
        .eq("id", it.id);
      results.push({ itemId: it.id, ok: true, storagePath: out.storagePath, fileName: out.fileName });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "generate_failed";
      await sb.from("sba_package_run_items").update({ status: "failed", error: msg }).eq("id", it.id);
      results.push({ itemId: it.id, ok: false, error: msg });
    }
  }

  const anyFailed = results.some((r) => !r.ok);
  await sb.from("sba_package_runs").update({ status: anyFailed ? "failed" : "generated" }).eq("id", run.id);

  return { ok: true, results };
}

export type AssembleFormsResult =
  | { ok: true; storagePath: string; itemCount: number; missingItems: string[] }
  | { ok: false; reason: "NO_PACKAGE_RUN" | "PACKAGE_RUN_NOT_FOUND" | "NO_GENERATED_ITEMS" | "MERGE_FAILED"; detail?: string };

export async function assembleBrokerageFormsPackage(dealId: string, sb: SupabaseClient): Promise<AssembleFormsResult> {
  const run = await resolveCurrentPackageRun(dealId, sb);
  if (!run) return { ok: false, reason: "NO_PACKAGE_RUN" };

  return assembleTenTabPackage({ supabase: sb, dealId, packageRunId: run.id });
}
