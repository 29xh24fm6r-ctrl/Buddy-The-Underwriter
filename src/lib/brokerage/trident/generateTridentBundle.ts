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
import { renderSBAPackagePDF } from "@/lib/sba/sbaPackageRenderer";
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
import { evaluateTridentRelease } from "./tridentReleaseGate";
import { assertTridentInputSnapshot, computeTridentInputHash } from "./tridentInputSnapshot";
import { generateCanonicalMemoArtifact } from "@/lib/creditMemo/canonical/generateCanonicalMemoArtifact";
import { renderClassicPdfSpread } from "@/lib/classicSpread/classicPdfWorker";

export type TridentBundleMode = "preview" | "final";

export async function createTridentBundleRun(args: {
  dealId: string;
  mode: TridentBundleMode;
}): Promise<{ ok: true; bundleId: string; reused: boolean } | { ok: false; error: string }> {
  const sb = supabaseAdmin();
  try {
    const inputHash = await computeTridentInputHash(sb, args.dealId);
    const { data, error } = await sb.rpc("acquire_trident_bundle_run", {
      p_deal_id: args.dealId,
      p_mode: args.mode,
      p_input_hash: inputHash,
    });
    const admitted = Array.isArray(data) ? data[0] : data;
    if (error || !admitted?.bundle_id) {
      return { ok: false, error: error?.message ?? "Atomic Trident admission failed" };
    }
    return {
      ok: true,
      bundleId: String(admitted.bundle_id),
      reused: admitted.reused === true,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

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
  bundleId?: string;
  bankId?: string;
  inputHash?: string;
}): Promise<GenerateResult> {
  const { dealId, mode } = args;
  const sb = supabaseAdmin();

  let dealQuery = sb.from("deals").select("id, bank_id, is_test").eq("id", dealId);
  if (args.bankId) dealQuery = dealQuery.eq("bank_id", args.bankId);
  const { data: deal } = await dealQuery.single();
  if (!deal) return { ok: false, bundleId: null, error: "Deal not found" };

  let bundleId: string;
  if (args.bundleId) {
    bundleId = args.bundleId;
    const { data: existing } = await sb
      .from("buddy_trident_bundles")
      .select("id, deal_id, bank_id, mode, input_hash, source_credit_memo_id, source_spread_id, canonical_memo_input_hash")
      .eq("id", bundleId)
      .eq("deal_id", dealId)
      .eq("bank_id", args.bankId ?? deal.bank_id)
      .eq("mode", mode)
      .eq("input_hash", args.inputHash ?? await computeTridentInputHash(sb, dealId))
      .maybeSingle();
    if (!existing) return { ok: false, bundleId: null, error: "Bundle run not found" };
    if (!args.bankId || !args.inputHash) {
      return { ok: false, bundleId, error: "Durable factory execution is missing admitted bank or input snapshot" };
    }
  } else {
    const { data: bundleRow, error: insertErr } = await sb
      .from("buddy_trident_bundles")
      .insert({
        deal_id: dealId,
        bank_id: deal.bank_id,
        mode,
        status: "pending",
        input_hash: await computeTridentInputHash(sb, dealId),
        redactor_version: mode === "preview" ? REDACTOR_VERSION : null,
      })
      .select("id")
      .single();
    if (insertErr || !bundleRow) {
      return { ok: false, bundleId: null, error: insertErr?.message ?? "Insert failed" };
    }
    bundleId = bundleRow.id;
  }

  const admittedBankId = args.bankId ?? deal.bank_id;
  const admittedInputHash = args.inputHash ?? await computeTridentInputHash(sb, dealId);
  await assertTridentInputSnapshot({ sb, dealId, expectedHash: admittedInputHash });

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
    // 1. SBA package (business plan PDF + package row).
    const sbaResult = await generateSBAPackage(dealId, { mode });
    if (!sbaResult.ok) {
      throw new Error(`SBA package generation failed: ${sbaResult.error}`);
    }

    // Audit fix (Borrower Intake Program review) — enrichBusinessPlanPackage
    // (SPEC-M8 ARTIFACT-PIPELINE-1's verifier pass) was wired into the SBA
    // generate-package route but not into this function, even though this
    // is the actual path used by borrower preview, admin/staff trigger, and
    // marketplace-pick final-mode generation (per this file's mode param).
    // Every business plan produced through the trident bundle was shipping
    // with zero AI fact-checking. Best-effort, non-fatal — matches the
    // sba/route.ts call site exactly: the package itself already generated
    // successfully by this point.
    let businessPlanVerification: Awaited<ReturnType<typeof enrichBusinessPlanPackage>> | null = null;
    try {
      businessPlanVerification = await enrichBusinessPlanPackage({
        dealId,
        bankId: deal.bank_id,
        packageId: sbaResult.packageId,
        sb,
      });
    } catch (enrichErr) {
      if (mode === "final") throw enrichErr;
      console.error("[generateTridentBundle] business-plan verification failed (preview only):", enrichErr);
    }

    if (mode === "final") {
      if (businessPlanVerification?.verdict !== "pass") {
        const findings = businessPlanVerification?.flaggedClaims
          .slice(0, 3)
          .map((finding) => `${finding.severity}: ${finding.reason}`)
          .join(" | ");
        throw new Error(
          "Business-plan institutional review did not pass; final publication blocked" +
            (findings ? ` — ${findings}` : ""),
        );
      }
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

    let reviewedBusinessPlanSource = sbaResult.pdfUrl;
    if (mode === "final") {
      const { data: reviewedNarratives, error: reviewedNarrativesError } = await sb
        .from("buddy_sba_packages")
        .select(
          "business_overview_narrative,executive_summary,industry_analysis,marketing_strategy,operations_plan," +
            "swot_strengths,swot_weaknesses,swot_opportunities,swot_threats,sensitivity_narrative,franchise_section",
        )
        .eq("id", sbaResult.packageId)
        .single();
      if (reviewedNarrativesError || !reviewedNarratives) {
        throw new Error(`Reviewed business-plan render read failed: ${reviewedNarrativesError?.message ?? "missing row"}`);
      }
      const reviewed = reviewedNarratives as unknown as Record<string, string | null>;
      const reviewedBuffer = await renderSBAPackagePDF({
        ...sbaResult.renderInput,
        businessOverviewNarrative: reviewed.business_overview_narrative ?? "",
        executiveSummary: reviewed.executive_summary ?? undefined,
        industryAnalysis: reviewed.industry_analysis ?? undefined,
        marketingStrategy: reviewed.marketing_strategy ?? undefined,
        operationsPlan: reviewed.operations_plan ?? undefined,
        swotStrengths: reviewed.swot_strengths ?? undefined,
        swotWeaknesses: reviewed.swot_weaknesses ?? undefined,
        swotOpportunities: reviewed.swot_opportunities ?? undefined,
        swotThreats: reviewed.swot_threats ?? undefined,
        sensitivityNarrative: reviewed.sensitivity_narrative ?? "",
        franchiseSection: reviewed.franchise_section ?? undefined,
      });
      reviewedBusinessPlanSource = await uploadReviewedPdf(sb, {
        dealId, artifact: "business_plan", buffer: reviewedBuffer,
      });
      await sb.from("buddy_sba_packages").update({ pdf_url: reviewedBusinessPlanSource }).eq("id", sbaResult.packageId);
    }

    const businessPlanPath = await copyToTridentBucket(sb, {
      sourceBucket: "deal-documents",
      sourcePath: reviewedBusinessPlanSource,
      dealId,
      mode,
      artifact: "business_plan",
      ext: "pdf",
    });
    if (!businessPlanPath) throw new Error("Business-plan artifact persistence failed");
    const { error: businessPlanPersistError } = await sb.from("buddy_trident_bundles").update({
      business_plan_pdf_path: businessPlanPath,
      source_sba_package_id: sbaResult.packageId,
      current_stage: "business_plan",
      last_heartbeat_at: new Date().toISOString(),
    }).eq("id", bundleId);
    if (businessPlanPersistError) throw new Error(`Business-plan manifest write failed: ${businessPlanPersistError.message}`);

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
        const { error: uploadError } = await sb.storage.from("trident-bundles").upload(path, xlsxBuf, {
          contentType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          upsert: true,
        });
        if (uploadError) throw new Error(`Projection workbook upload failed: ${uploadError.message}`);
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

    const { error: projectionsPersistError } = await sb.from("buddy_trident_bundles").update({
      projections_pdf_path: projectionsPdfPath,
      projections_xlsx_path: projectionsXlsxPath,
      current_stage: "projections",
      last_heartbeat_at: new Date().toISOString(),
    }).eq("id", bundleId);
    if (projectionsPersistError) throw new Error(`Projection manifest write failed: ${projectionsPersistError.message}`);

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
        if (mode === "final" && sourceFeasibilityId && feasResult.composite) {
          const feasibilityVerification = await enrichFeasibilityStudy({
            dealId,
            bankId: deal.bank_id,
            studyId: sourceFeasibilityId,
            composite: feasResult.composite,
            sb,
          });
          if (feasibilityVerification.verdict !== "pass") {
            const { data: reviewEvidence } = await sb
              .from("buddy_feasibility_studies")
              .select("verification_flagged_claims")
              .eq("id", sourceFeasibilityId)
              .maybeSingle();
            const findings = Array.isArray(reviewEvidence?.verification_flagged_claims)
              ? reviewEvidence.verification_flagged_claims
                  .slice(0, 3)
                  .map((finding: { severity?: unknown; reason?: unknown }) =>
                    `${String(finding.severity ?? "warning")}: ${String(finding.reason ?? "unresolved review finding")}`,
                  )
                  .join(" | ")
              : "";
            throw new Error(
              "Feasibility institutional review did not pass; final publication blocked" +
                (findings ? ` — ${findings}` : ""),
            );
          }
        }
        if (mode === "final" && sourceFeasibilityId) {
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
        if (mode === "final" && sourceFeasibilityId && feasResult.renderInput) {
          const { data: reviewedStudy, error: reviewedStudyError } = await sb
            .from("buddy_feasibility_studies")
            .select("narratives")
            .eq("id", sourceFeasibilityId)
            .single();
          if (reviewedStudyError || !reviewedStudy?.narratives) {
            throw new Error(`Reviewed feasibility render read failed: ${reviewedStudyError?.message ?? "missing narratives"}`);
          }
          const reviewedBuffer = await renderFeasibilityPDF({
            ...feasResult.renderInput,
            narratives: reviewedStudy.narratives as any,
          });
          const reviewedFeasibilitySource = await uploadReviewedPdf(sb, {
            dealId, artifact: "feasibility", buffer: reviewedBuffer,
          });
          await sb.from("buddy_feasibility_studies").update({ pdf_url: reviewedFeasibilitySource }).eq("id", sourceFeasibilityId);
          feasibilityPdfPath = await copyToTridentBucket(sb, {
            sourceBucket: "deal-documents",
            sourcePath: reviewedFeasibilitySource,
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
      if (mode === "final") throw feasErr;
      console.warn("[trident] feasibility render failed (non-fatal):", feasErr);
    }

    const { error: feasibilityPersistError } = await sb.from("buddy_trident_bundles").update({
      feasibility_pdf_path: feasibilityPdfPath,
      source_feasibility_id: sourceFeasibilityId,
      current_stage: "feasibility",
      last_heartbeat_at: new Date().toISOString(),
    }).eq("id", bundleId);
    if (feasibilityPersistError) throw new Error(`Feasibility manifest write failed: ${feasibilityPersistError.message}`);

    // 4. Bind a final release to the exact memo, spread, and reviewed
    // artifacts from this run. Preview remains intentionally non-release.
    let releaseManifest: Record<string, unknown> | null = null;
    let sourceCreditMemoId: string | null = null;
    let sourceSpreadId: string | null = null;
    let canonicalMemoInputHash: string | null = null;
    if (mode === "final") {
      await assertTridentInputSnapshot({ sb, dealId, expectedHash: admittedInputHash });

      // Standalone final callers (notably lender pick) have no preceding
      // durable canonical stage. Commission once and bind its exact outputs;
      // durable workflow calls always arrive with bundleId and skip this.
      if (!args.bundleId) {
        const memo = await generateCanonicalMemoArtifact({
          dealId,
          bankId: admittedBankId,
          forceRegenerate: false,
          executionContext: "system",
        });
        if (!memo.ok) throw new Error(memo.error);
        const spread = await renderClassicPdfSpread({ dealId, bankId: admittedBankId });
        if (!spread.ok) throw new Error(spread.error);
        await assertTridentInputSnapshot({ sb, dealId, expectedHash: admittedInputHash });
        const [{ data: memoRow }, { data: spreadRow }] = await Promise.all([
          sb.from("canonical_memo_narratives").select("id")
            .eq("deal_id", dealId).eq("bank_id", admittedBankId)
            .eq("input_hash", admittedInputHash).limit(1).maybeSingle(),
          sb.from("deal_spreads").select("id")
            .eq("deal_id", dealId).eq("bank_id", admittedBankId)
            .eq("spread_type", "CLASSIC_PDF").eq("status", "ready")
            .order("updated_at", { ascending: false }).limit(1).maybeSingle(),
        ]);
        if (!memoRow?.id || !spreadRow?.id) {
          throw new Error("Standalone canonical sources were not durably persisted");
        }
        const { error: bindError } = await sb.from("buddy_trident_bundles").update({
          source_credit_memo_id: memoRow.id,
          source_spread_id: spreadRow.id,
          canonical_memo_input_hash: admittedInputHash,
        }).eq("id", bundleId).eq("bank_id", admittedBankId).eq("input_hash", admittedInputHash);
        if (bindError) throw new Error(`Standalone canonical source binding failed: ${bindError.message}`);
      }
      const { data: boundSources, error: boundSourcesError } = await sb
        .from("buddy_trident_bundles")
        .select("source_credit_memo_id,source_spread_id,canonical_memo_input_hash")
        .eq("id", bundleId)
        .eq("bank_id", admittedBankId)
        .eq("input_hash", admittedInputHash)
        .single();
      if (boundSourcesError || !boundSources?.source_credit_memo_id || !boundSources?.source_spread_id) {
        throw new Error(`Canonical factory sources are not bound to the admitted bundle: ${boundSourcesError?.message ?? "missing source IDs"}`);
      }
      canonicalMemoInputHash = boundSources.canonical_memo_input_hash;
      if (canonicalMemoInputHash !== admittedInputHash) {
        throw new Error(`Canonical memo snapshot drift: admitted=${admittedInputHash} canonical=${canonicalMemoInputHash ?? "missing"}`);
      }
      const [{ data: releasePkg }, { data: releaseFeasibility }, { data: releaseMemo }, { data: releaseSpread }] = await Promise.all([
        sb.from("buddy_sba_packages")
          .select("verification_verdict,projections_assumptions_narrative,sources_and_uses")
          .eq("id", sbaResult.packageId).single(),
        sb.from("buddy_feasibility_studies")
          .select("verification_verdict,data_completeness,narrative_citations")
          .eq("id", sourceFeasibilityId).single(),
        sb.from("canonical_memo_narratives")
          .select("id,input_hash,research_trust_grade")
          .eq("id", boundSources.source_credit_memo_id)
          .eq("deal_id", dealId).eq("bank_id", admittedBankId)
          .eq("input_hash", admittedInputHash).single(),
        sb.from("deal_spreads")
          .select("id,status,rendered_json")
          .eq("id", boundSources.source_spread_id)
          .eq("deal_id", dealId).eq("bank_id", admittedBankId)
          .eq("spread_type", "CLASSIC_PDF").single(),
      ]);
      const citationEntries = releaseFeasibility?.narrative_citations && typeof releaseFeasibility.narrative_citations === "object"
        ? Object.values(releaseFeasibility.narrative_citations as Record<string, unknown>) : [];
      const citationCount = citationEntries.filter((entry) => {
        const value = entry as { precise?: unknown; urls?: unknown } | null;
        return value?.precise === true && Array.isArray(value.urls) && value.urls.length > 0;
      }).length;
      const spreadPayload = releaseSpread?.rendered_json as Record<string, unknown> | null;
      const gate = evaluateTridentRelease({
        businessPlanVerdict: releasePkg?.verification_verdict,
        feasibilityVerdict: releaseFeasibility?.verification_verdict,
        feasibilityCompleteness: releaseFeasibility?.data_completeness,
        feasibilityCitationCount: citationCount,
        projectionsNarrative: releasePkg?.projections_assumptions_narrative,
        sourcesAndUses: releasePkg?.sources_and_uses,
        memoId: releaseMemo?.id ?? null,
        memoInputHash: releaseMemo?.input_hash ?? null,
        expectedMemoInputHash: canonicalMemoInputHash,
        memoResearchTrustGrade: releaseMemo?.research_trust_grade ?? null,
        isTestDeal: deal.is_test === true,
        spreadId: releaseSpread?.id ?? null,
        spreadReady: releaseSpread?.status === "ready",
        spreadHasIntegrityHash: Boolean(spreadPayload?.pdf_sha256),
        spreadHasCanonicalFactsTimestamp: Boolean(spreadPayload?.canonicalFactsTimestamp),
        artifactPaths: [businessPlanPath, projectionsXlsxPath, feasibilityPdfPath],
      });
      releaseManifest = {
        ...gate,
        evaluated_at: new Date().toISOString(),
        source_sba_package_id: sbaResult.packageId,
        source_feasibility_id: sourceFeasibilityId,
        source_credit_memo_id: releaseMemo?.id ?? null,
        source_spread_id: releaseSpread?.id ?? null,
        canonical_memo_input_hash: canonicalMemoInputHash,
      };
      await sb.from("buddy_trident_bundles").update({ release_gate_json: releaseManifest }).eq("id", bundleId);
      if (!gate.ok) throw new Error(`Golden Trident release blocked: ${gate.reasons.join(", ")}`);
      sourceCreditMemoId = releaseMemo?.id ?? null;
      sourceSpreadId = releaseSpread?.id ?? null;
    }

    // 5. Supersede prior current succeeded bundle for this (deal, mode),
    //    then mark this one succeeded. Partial unique index is the
    //    integrity guarantee; this sequence keeps it satisfied.
    await sb
      .from("buddy_trident_bundles")
      .update({ superseded_at: new Date().toISOString() })
      .eq("deal_id", dealId)
      .eq("bank_id", admittedBankId)
      .eq("mode", mode)
      .eq("status", "succeeded")
      .is("superseded_at", null)
      .neq("id", bundleId);

    await assertTridentInputSnapshot({ sb, dealId, expectedHash: admittedInputHash });
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
        source_credit_memo_id: sourceCreditMemoId,
        source_spread_id: sourceSpreadId,
        canonical_memo_input_hash: canonicalMemoInputHash,
        release_gate_json: releaseManifest,
      })
      .eq("id", bundleId)
      .eq("bank_id", admittedBankId)
      .eq("input_hash", admittedInputHash);

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
        generation_error: msg,
        stage_error_json: { stage: "artifact_factory", message: msg },
        generation_completed_at: new Date().toISOString(),
        last_heartbeat_at: new Date().toISOString(),
      })
      .eq("id", bundleId);
    return { ok: false, bundleId, error: msg };
  }
    },
  );
}

async function uploadReviewedPdf(
  sb: SupabaseClient,
  args: { dealId: string; artifact: string; buffer: Buffer },
): Promise<string> {
  const path = `${args.artifact === "business_plan" ? "sba-packages" : "feasibility-studies"}/${args.dealId}/${Date.now()}_reviewed.pdf`;
  const { error } = await sb.storage.from("deal-documents").upload(path, args.buffer, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (error) throw new Error(`Reviewed ${args.artifact} PDF upload failed: ${error.message}`);
  return path;
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
  if (downloadErr || !data) {
    throw new Error(`Artifact source download failed: ${downloadErr?.message ?? "missing data"}`);
  }

  const buf = Buffer.from(await data.arrayBuffer());
  const targetPath = `${args.dealId}/${args.mode}/${Date.now()}_${args.artifact}.${args.ext}`;
  const { error: uploadError } = await sb.storage.from("trident-bundles").upload(targetPath, buf, {
    contentType:
      args.ext === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    upsert: true,
  });
  if (uploadError) throw new Error(`Artifact target upload failed: ${uploadError.message}`);
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
