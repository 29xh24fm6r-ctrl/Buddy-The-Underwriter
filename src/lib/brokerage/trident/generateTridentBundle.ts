import "server-only";

/**
 * Trident bundle orchestrator.
 *
 * State machine per S3-2:
 *   pending → running → succeeded | failed
 *
 * - A succeeded bundle supersedes any prior current succeeded bundle for the
 *   same (deal, mode). The partial unique index enforces correctness.
 * - A failed bundle does NOT supersede a prior success. If a later preview
 *   regeneration fails, the download route still returns the prior success.
 *
 * Feasibility wrapper: `generateFeasibilityStudy` has no mode parameter.
 * For preview we call it (produces the persisted final PDF in deal-documents)
 * then re-render via `renderFeasibilityPDF` with redacted narratives.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { generateSBAPackage } from "@/lib/sba/sbaPackageOrchestrator";
import { generateFeasibilityStudy } from "@/lib/feasibility/feasibilityEngine";
import { renderFeasibilityPDF } from "@/lib/feasibility/feasibilityRenderer";
import { renderProjectionsXlsx } from "./projectionsXlsx";
import {
  REDACTOR_VERSION,
  redactFeasibilityForPreview,
} from "./redactor";

export type TridentBundleMode = "preview" | "final";

export type GenerateResult =
  | {
      ok: true;
      bundleId: string;
      mode: TridentBundleMode;
      paths: {
        businessPlanPdf: string | null;
        projectionsPdf: string | null;
        projectionsXlsx: string | null;
        feasibilityPdf: string | null;
      };
    }
  | { ok: false; bundleId: string | null; error: string };

export async function generateTridentBundle(args: {
  dealId: string;
  mode: TridentBundleMode;
}): Promise<GenerateResult> {
  const { dealId, mode } = args;
  const sb = supabaseAdmin();

  const { data: deal } = await sb
    .from("deals")
    .select("id, bank_id")
    .eq("id", dealId)
    .single();
  if (!deal) return { ok: false, bundleId: null, error: "Deal not found" };

  const { data: bundleRow, error: insertErr } = await sb
    .from("buddy_trident_bundles")
    .insert({
      deal_id: dealId,
      bank_id: deal.bank_id,
      mode,
      status: "pending",
      redactor_version: mode === "preview" ? REDACTOR_VERSION : null,
    })
    .select("id")
    .single();
  if (insertErr || !bundleRow) {
    return {
      ok: false,
      bundleId: null,
      error: insertErr?.message ?? "Insert failed",
    };
  }
  const bundleId = bundleRow.id;

  await sb
    .from("buddy_trident_bundles")
    .update({
      status: "running",
      generation_started_at: new Date().toISOString(),
    })
    .eq("id", bundleId);

  try {
    // 1. SBA package (business plan PDF + package row).
    const sbaResult = await generateSBAPackage(dealId, { mode });
    if (!sbaResult.ok) {
      throw new Error(`SBA package generation failed: ${sbaResult.error}`);
    }

    const businessPlanPath = await copyToTridentBucket(sb, {
      sourceBucket: "deal-documents",
      sourcePath: sbaResult.pdfUrl,
      dealId,
      mode,
      artifact: "business_plan",
      ext: "pdf",
    });

    // 2. Projections XLSX — final mode only.
    let projectionsXlsxPath: string | null = null;
    if (mode === "final") {
      const { data: pkgRow } = await sb
        .from("buddy_sba_packages")
        .select(
          "projections_annual, projections_monthly, sensitivity_scenarios, sources_and_uses, balance_sheet_projections, base_year_data",
        )
        .eq("id", sbaResult.packageId)
        .single();

      if (pkgRow) {
        const xlsxBuf = await renderProjectionsXlsx({
          dealName: "Deal",
          baseYear: (pkgRow.base_year_data as any) ?? {},
          annualProjections: (pkgRow.projections_annual as any) ?? [],
          monthlyProjections: (pkgRow.projections_monthly as any) ?? [],
          sensitivityScenarios: (pkgRow.sensitivity_scenarios as any) ?? [],
          sourcesAndUses: pkgRow.sources_and_uses,
          balanceSheetProjections: pkgRow.balance_sheet_projections,
        });
        const path = `${dealId}/${mode}/${Date.now()}_projections.xlsx`;
        await sb.storage.from("trident-bundles").upload(path, xlsxBuf, {
          contentType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          upsert: true,
        });
        projectionsXlsxPath = path;
      }
    }
    // Preview borrowers see the business-plan PDF which already embeds
    // projections; no separate projections PDF/XLSX for preview mode.
    const projectionsPdfPath: string | null = null;

    // 3. Feasibility — call engine; for preview, re-render with redaction.
    let feasibilityPdfPath: string | null = null;
    let sourceFeasibilityId: string | null = null;
    try {
      const feasResult = await generateFeasibilityStudy({
        dealId,
        bankId: deal.bank_id,
      });
      if (feasResult.ok) {
        sourceFeasibilityId = feasResult.studyId ?? null;
        if (mode === "final" && feasResult.pdfUrl) {
          feasibilityPdfPath = await copyToTridentBucket(sb, {
            sourceBucket: "deal-documents",
            sourcePath: feasResult.pdfUrl,
            dealId,
            mode,
            artifact: "feasibility",
            ext: "pdf",
          });
        } else if (mode === "preview" && sourceFeasibilityId) {
          feasibilityPdfPath = await renderFeasibilityPreview(sb, {
            studyId: sourceFeasibilityId,
            dealId,
          });
        }
      }
    } catch (feasErr) {
      console.warn("[trident] feasibility render failed (non-fatal):", feasErr);
    }

    // 4. Supersede prior current succeeded bundle for this (deal, mode),
    //    then mark this one succeeded. Partial unique index is the
    //    integrity guarantee; this sequence keeps it satisfied.
    await sb
      .from("buddy_trident_bundles")
      .update({ superseded_at: new Date().toISOString() })
      .eq("deal_id", dealId)
      .eq("mode", mode)
      .eq("status", "succeeded")
      .is("superseded_at", null)
      .neq("id", bundleId);

    await sb
      .from("buddy_trident_bundles")
      .update({
        status: "succeeded",
        generation_completed_at: new Date().toISOString(),
        business_plan_pdf_path: businessPlanPath,
        projections_pdf_path: projectionsPdfPath,
        projections_xlsx_path: projectionsXlsxPath,
        feasibility_pdf_path: feasibilityPdfPath,
        source_sba_package_id: sbaResult.packageId,
        source_feasibility_id: sourceFeasibilityId,
      })
      .eq("id", bundleId);

    return {
      ok: true,
      bundleId,
      mode,
      paths: {
        businessPlanPdf: businessPlanPath,
        projectionsPdf: projectionsPdfPath,
        projectionsXlsx: projectionsXlsxPath,
        feasibilityPdf: feasibilityPdfPath,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[trident] generation failed:", msg);
    await sb
      .from("buddy_trident_bundles")
      .update({
        status: "failed",
        generation_error: msg.slice(0, 500),
        generation_completed_at: new Date().toISOString(),
      })
      .eq("id", bundleId);
    return { ok: false, bundleId, error: msg };
  }
}

async function copyToTridentBucket(
  sb: SupabaseClient,
  args: {
    sourceBucket: string;
    sourcePath: string | null;
    dealId: string;
    mode: TridentBundleMode;
    artifact: string;
    ext: string;
  },
): Promise<string | null> {
  if (!args.sourcePath) return null;
  const { data, error: downloadErr } = await sb.storage
    .from(args.sourceBucket)
    .download(args.sourcePath);
  if (downloadErr || !data) return null;

  const buf = Buffer.from(await data.arrayBuffer());
  const targetPath = `${args.dealId}/${args.mode}/${Date.now()}_${args.artifact}.${args.ext}`;
  await sb.storage.from("trident-bundles").upload(targetPath, buf, {
    contentType:
      args.ext === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    upsert: true,
  });
  return targetPath;
}

/**
 * Re-render the feasibility PDF with preview redaction applied + watermark.
 * Reads the just-persisted feasibility row and rebuilds a FeasibilityRenderInput.
 * Narratives pass through redactFeasibilityForPreview; scores are untouched.
 */
async function renderFeasibilityPreview(
  sb: SupabaseClient,
  args: { studyId: string; dealId: string },
): Promise<string | null> {
  const { data: study } = await sb
    .from("buddy_feasibility_studies")
    .select("*")
    .eq("id", args.studyId)
    .maybeSingle();
  if (!study) return null;

  // Redact narratives. Scores already pass through as-is.
  const rawNarratives =
    (study.narratives as Record<string, string> | null) ?? {};
  const redacted = redactFeasibilityForPreview({
    compositeScore: (study.composite_score as number) ?? 0,
    marketDemandScore: (study.market_demand_score as number) ?? 0,
    financialViabilityScore: (study.financial_viability_score as number) ?? 0,
    operationalReadinessScore:
      (study.operational_readiness_score as number) ?? 0,
    locationSuitabilityScore: (study.location_suitability_score as number) ?? 0,
    narratives: rawNarratives,
  });

  const input = {
    dealName: (study.deal_name as string) ?? "Borrower",
    city: (study.city as string | null) ?? null,
    state: (study.state as string | null) ?? null,
    composite: (study.composite_detail as any) ?? {
      compositeScore: redacted.compositeScore,
      recommendation: "PROCEED",
    },
    marketDemand: (study.market_demand_detail as any) ?? {},
    financialViability: (study.financial_viability_detail as any) ?? {},
    operationalReadiness: (study.operational_readiness_detail as any) ?? {},
    locationSuitability: (study.location_suitability_detail as any) ?? {},
    narratives: redacted.narratives as any,
    franchiseComparison: (study.franchise_comparison as any) ?? null,
    isFranchise: Boolean(study.is_franchise),
    brandName: (study.brand_name as string | null) ?? null,
    generatedAt: (study.generated_at as string | null) ?? undefined,
    previewWatermark: true,
  };

  let buf: Buffer;
  try {
    buf = await renderFeasibilityPDF(input);
  } catch {
    return null;
  }

  const path = `${args.dealId}/preview/${Date.now()}_feasibility.pdf`;
  const { error } = await sb.storage
    .from("trident-bundles")
    .upload(path, buf, {
      contentType: "application/pdf",
      upsert: true,
    });
  if (error) return null;
  return path;
}
