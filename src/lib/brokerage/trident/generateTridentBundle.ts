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
import { enrichBusinessPlanPackage } from "@/lib/sba/enrichBusinessPlanPackage";
import { hashPackageNarratives, getBusinessPlanAttestationStatus } from "@/lib/sba/businessPlanAttestation";
import { generateFeasibilityStudy } from "@/lib/feasibility/feasibilityEngine";
import { enrichFeasibilityStudy } from "@/lib/feasibility/enrichFeasibilityStudy";
import { renderFeasibilityPDF } from "@/lib/feasibility/feasibilityRenderer";
import { renderProjectionsXlsx } from "./projectionsXlsx";
import { renderProjectionsPreviewPdf } from "./projectionsPreviewPdf";
import {
  REDACTOR_VERSION,
  redactFeasibilityForPreview,
} from "./redactor";
import {
  assessBusinessPlanNarratives,
  assessFeasibilityNarratives,
} from "./narrativeAcceptance";
import { runWithAIExecutionContext } from "@/lib/ai/executionContext";

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
      /**
       * SPEC-M8 ARTIFACT-PIPELINE-1 — informational only, never blocks
       * generation. Whether the borrower has attested to the EXACT
       * narrative snapshot included in businessPlanPdf. false whenever the
       * lookup itself fails (fail-closed on the metadata, never on the
       * bundle) — a lender consuming this bundle should not conflate
       * "unknown" with "attested."
       */
      businessPlanAttested: boolean;
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

  return runWithAIExecutionContext(
    {
      dealId,
      traceId: bundleId,
      artifactType: "trident_bundle",
      artifactId: bundleId,
      // A full borrower package contains names, financials, tax-derived
      // values, and management details. Nested helpers may never downgrade
      // this classification by omitting or explicitly clearing npiTagged.
      npiTagged: true,
    },
    async () => {
  try {
    // Start feasibility's independent deal/research work immediately, but
    // give its financial phase a deferred dependency on THIS bundle's exact
    // SBA package. This preserves concurrency without allowing a "latest row"
    // race to bind feasibility to a prior run.
    let resolveProjectionPackage!: (packageId: string) => void;
    let rejectProjectionPackage!: (error: unknown) => void;
    const projectionPackageId = new Promise<string>((resolve, reject) => {
      resolveProjectionPackage = resolve;
      rejectProjectionPackage = reject;
    });
    const feasibilityGeneration = generateFeasibilityLane(sb, {
      dealId,
      bankId: deal.bank_id,
      mode,
      projectionsPackageId: projectionPackageId,
    }).then(
      (result) => ({ result, error: null as unknown }),
      (error: unknown) => ({ result: null, error }),
    );

    // 1. SBA package (business plan PDF + package row).
    let sbaResult: Awaited<ReturnType<typeof generateSBAPackage>>;
    try {
      sbaResult = await generateSBAPackage(dealId, { mode });
    } catch (error) {
      rejectProjectionPackage(error);
      throw error;
    }
    if (!sbaResult.ok) {
      const error = new Error(`SBA package generation failed: ${sbaResult.error}`);
      rejectProjectionPackage(error);
      throw error;
    }
    resolveProjectionPackage(sbaResult.packageId);

    // Audit fix (Borrower Intake Program review) — enrichBusinessPlanPackage
    // (SPEC-M8 ARTIFACT-PIPELINE-1's verifier pass) was wired into the SBA
    // generate-package route but not into this function, even though this
    // is the actual path used by borrower preview, admin/staff trigger, and
    // marketplace-pick final-mode generation (per this file's mode param).
    // Every business plan produced through the trident bundle was shipping
    // with zero AI fact-checking. Best-effort, non-fatal — matches the
    // sba/route.ts call site exactly: the package itself already generated
    // successfully by this point.
    try {
      await enrichBusinessPlanPackage({
        dealId,
        bankId: deal.bank_id,
        packageId: sbaResult.packageId,
        sb,
      });
    } catch (enrichErr) {
      console.error("[generateTridentBundle] business-plan verification failed (non-fatal):", enrichErr);
    }

    if (mode === "final") {
      const { data: narrativeRow, error: narrativeReadError } = await sb
        .from("buddy_sba_packages")
        .select(
          "business_overview_narrative,executive_summary,industry_analysis,marketing_strategy,operations_plan," +
            "swot_strengths,swot_weaknesses,swot_opportunities,swot_threats,sensitivity_narrative",
        )
        .eq("id", sbaResult.packageId)
        .maybeSingle();
      if (narrativeReadError) {
        throw new Error(`Business-plan narrative acceptance read failed: ${narrativeReadError.message}`);
      }
      const acceptance = assessBusinessPlanNarratives(
        narrativeRow as Record<string, unknown> | null,
      );
      if (!acceptance.ok) {
        throw new Error(
          `Business-plan narrative acceptance failed: ${acceptance.substantive}/${acceptance.total} core sections are substantive`,
        );
      }
    }

    const businessPlanPath = await copyToTridentBucket(sb, {
      sourceBucket: "deal-documents",
      sourcePath: sbaResult.pdfUrl,
      dealId,
      mode,
      artifact: "business_plan",
      ext: "pdf",
    });

    // SPEC-M8 ARTIFACT-PIPELINE-1 — read-only attestation lookup. Never
    // blocks bundle generation (see GenerateResult's businessPlanAttested
    // doc comment) — this repo has multiple live, fully-automated callers
    // of this function (marketplace-pick final-mode generation in
    // particular) with zero borrower interaction, and hard-gating on
    // attestation here would regress them.
    let businessPlanAttested = false;
    try {
      const { data: narrativeCols } = await sb
        .from("buddy_sba_packages")
        .select(
          "business_overview_narrative, executive_summary, industry_analysis, marketing_strategy, " +
            "operations_plan, swot_strengths, swot_weaknesses, swot_opportunities, swot_threats, " +
            "sensitivity_narrative, plan_thesis",
        )
        .eq("id", sbaResult.packageId)
        .maybeSingle();
      if (narrativeCols) {
        const snapshotHash = hashPackageNarratives(narrativeCols as unknown as Record<string, unknown>);
        const status = await getBusinessPlanAttestationStatus(dealId, snapshotHash, sb);
        businessPlanAttested = status.attested && status.snapshotMatchesCurrent;
      }
    } catch (e) {
      console.warn("[trident] business-plan attestation lookup failed (non-fatal):", e);
    }

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
    // Preview projections PDF — summary-only (Y1 revenue, Y1 DSCR, break-even
    // month). Detailed monthly + annual cells are NEVER rendered into this
    // file: the redaction is at the data layer, not just a watermark, so
    // the raw workbook can't be uncovered by stripping a layer or copying
    // the page. Final unwatermarked workbook ships at lender pick.
    let projectionsPdfPath: string | null = null;
    if (mode === "preview") {
      try {
        const { data: pkgRowPrev } = await sb
          .from("buddy_sba_packages")
          .select("base_year_data, projections_annual, break_even, deal_id")
          .eq("id", sbaResult.packageId)
          .single();

        const annual0 =
          ((pkgRowPrev?.projections_annual as any[]) ?? [])[0] ?? null;
        const dscrYear1Base = annual0?.dscr ?? null;
        const year1Revenue = annual0?.revenue ?? null;
        const breakEven = (pkgRowPrev?.break_even as any) ?? null;

        const previewBuf = await renderProjectionsPreviewPdf({
          dealName: "Borrower",
          year1Revenue:
            typeof year1Revenue === "number" ? year1Revenue : null,
          year1Dscr:
            typeof dscrYear1Base === "number" ? dscrYear1Base : null,
          breakEvenMonth:
            breakEven && typeof breakEven.breakEvenMonth === "number"
              ? breakEven.breakEvenMonth
              : null,
          generatedAt: new Date().toISOString(),
        });
        const previewPath = `${dealId}/${mode}/${Date.now()}_projections.pdf`;
        const { error: uploadErr } = await sb.storage
          .from("trident-bundles")
          .upload(previewPath, previewBuf, {
            contentType: "application/pdf",
            upsert: true,
          });
        if (!uploadErr) projectionsPdfPath = previewPath;
      } catch (e) {
        console.warn(
          "[trident] projections preview render failed (non-fatal):",
          e instanceof Error ? e.message : String(e),
        );
      }
    }

    // 3. Join the independently running feasibility lane. Generation,
    // institutional review, acceptance, rendering, and copy all began at the
    // start of the bundle instead of waiting behind the SBA lane.
    let feasibilityPdfPath: string | null = null;
    let sourceFeasibilityId: string | null = null;
    const feasibilityOutcome = await feasibilityGeneration;
    if (feasibilityOutcome.error) {
      if (mode === "final") throw feasibilityOutcome.error;
      console.warn("[trident] feasibility render failed (non-fatal):", feasibilityOutcome.error);
    } else if (feasibilityOutcome.result) {
      feasibilityPdfPath = feasibilityOutcome.result.feasibilityPdfPath;
      sourceFeasibilityId = feasibilityOutcome.result.sourceFeasibilityId;
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
        business_plan_attested: businessPlanAttested,
        business_plan_attested_at: businessPlanAttested ? new Date().toISOString() : null,
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
      businessPlanAttested,
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
    },
  );
}

async function generateFeasibilityLane(
  sb: SupabaseClient,
  args: {
    dealId: string;
    bankId: string;
    mode: TridentBundleMode;
    projectionsPackageId: Promise<string>;
  },
): Promise<{ feasibilityPdfPath: string | null; sourceFeasibilityId: string | null }> {
  const feasResult = await generateFeasibilityStudy({
    dealId: args.dealId,
    bankId: args.bankId,
    projectionsPackageId: args.projectionsPackageId,
  });
  if (!feasResult.ok) {
    if (args.mode === "final") {
      throw new Error(
        `Feasibility generation failed: ${feasResult.error ?? "unknown error"}`,
      );
    }
    return { feasibilityPdfPath: null, sourceFeasibilityId: null };
  }

  const expectedPackageId = await args.projectionsPackageId;
  if (feasResult.projectionsPackageId !== expectedPackageId) {
    throw new Error(
      `Feasibility projection provenance mismatch: expected ${expectedPackageId}, received ${feasResult.projectionsPackageId ?? "none"}`,
    );
  }

  const sourceFeasibilityId = feasResult.studyId ?? null;
  if (args.mode === "final" && sourceFeasibilityId && feasResult.composite) {
    await enrichFeasibilityStudy({
      dealId: args.dealId,
      bankId: args.bankId,
      studyId: sourceFeasibilityId,
      composite: feasResult.composite,
      sb,
    });
  }

  if (args.mode === "final" && sourceFeasibilityId) {
    const { data: feasibilityRow, error: feasibilityReadError } = await sb
      .from("buddy_feasibility_studies")
      .select("narratives")
      .eq("id", sourceFeasibilityId)
      .maybeSingle();
    if (feasibilityReadError) {
      throw new Error(`Feasibility narrative acceptance read failed: ${feasibilityReadError.message}`);
    }
    const acceptance = assessFeasibilityNarratives(
      (feasibilityRow?.narratives as Record<string, unknown> | null) ?? null,
    );
    if (!acceptance.ok) {
      throw new Error(
        `Feasibility narrative acceptance failed: ${acceptance.substantive}/${acceptance.required} required sections are substantive`,
      );
    }
  }

  let feasibilityPdfPath: string | null = null;
  if (args.mode === "final" && feasResult.pdfUrl) {
    feasibilityPdfPath = await copyToTridentBucket(sb, {
      sourceBucket: "deal-documents",
      sourcePath: feasResult.pdfUrl,
      dealId: args.dealId,
      mode: args.mode,
      artifact: "feasibility",
      ext: "pdf",
    });
  } else if (args.mode === "preview" && sourceFeasibilityId) {
    feasibilityPdfPath = await renderFeasibilityPreview(sb, {
      studyId: sourceFeasibilityId,
      dealId: args.dealId,
    });
  }

  return { feasibilityPdfPath, sourceFeasibilityId };
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
