import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { buildCommitteeBlockerResolutions } from "@/lib/research/committeeBlockerResolution";
import {
  loadCommitteeTasks,
  persistEnrichedCommitteeTasks,
} from "@/lib/research/committeeEvidenceCollection";
import { enrichCommitteeTasks } from "@/lib/research/committeeEvidenceLinkage";
import {
  buildCommitteeRequirementsPlan,
  type CommitteeRequirementsPlan,
} from "@/lib/research/committeeRequirementsEngine";
import {
  buildSourceCandidatePlan,
  type SourceCandidatePlan,
} from "@/lib/research/sourceConnectors";
import {
  buildDecisionEvidenceProjection,
  buildResearchFactProjection,
  type DecisionEvidenceProjection,
  type ResearchFactProjection,
} from "@/lib/research/committeeEvidenceProjection";
import {
  buildCommitteeBlockerImpactPreview,
  type CommitteeBlockerImpactPreview,
} from "@/lib/research/committeeBlockerImpactPreview";
import {
  evaluateCommitteeReadinessTransition,
  buildCommitteeReadinessSection,
  type CommitteeReadinessTransitionResult,
  type CommitteeReadinessSection,
} from "@/lib/research/committeeReadinessTransition";

export const runtime = "nodejs";
export const maxDuration = 10;

type Params = Promise<{ dealId: string }>;

export async function GET(_req: NextRequest, ctx: { params: Params }) {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
    }

    const sb = supabaseAdmin();

    // 1. Latest quality gate for this deal
    const { data: gate } = await sb
      .from("buddy_research_quality_gates")
      .select("*")
      .eq("deal_id", dealId)
      .order("evaluated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // 2. Latest mission for this deal
    const { data: mission } = await sb
      .from("buddy_research_missions")
      .select("id, subject")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // 3. Evidence claims for that mission (full rows for blocker-resolution linkage)
    let evidence: Array<{
      id?: string | null;
      section?: string | null;
      thread_origin: string | null;
      claim_layer: string | null;
      evidence_type?: string | null;
      claim?: string | null;
      confidence: number | null;
      source_uris?: string[] | null;
      source_types?: string[] | null;
    }> = [];

    if (mission?.id) {
      const { data: ev } = await sb
        .from("buddy_research_evidence")
        .select("id, section, thread_origin, claim_layer, evidence_type, claim, confidence, source_uris, source_types")
        .eq("mission_id", mission.id);
      evidence = ev ?? [];
    }

    // Aggregate by thread
    type ThreadCount = { total: number; fact: number; inference: number; narrative: number };
    const byThread: Record<string, ThreadCount> = {};
    for (const row of evidence) {
      const t = row.thread_origin ?? "unknown";
      if (!byThread[t]) byThread[t] = { total: 0, fact: 0, inference: 0, narrative: 0 };
      byThread[t].total++;
      if (row.claim_layer === "fact")      byThread[t].fact++;
      if (row.claim_layer === "inference") byThread[t].inference++;
      if (row.claim_layer === "narrative") byThread[t].narrative++;
    }

    // SPEC-BIE-EVIDENCE-GRAPH-AND-COMMITTEE-BLOCKER-RESOLUTION-1: derive
    // evidence-linked, actionable resolution items for each committee blocker.
    // Pure / derived-on-read — no new table.
    const subj = (mission?.subject ?? null) as { company_name?: string | null; website?: string | null } | null;
    let committee_blocker_resolutions = gate
      ? buildCommitteeBlockerResolutions({
          committeeBlockers: (gate.committee_blockers as string[]) ?? [],
          evidenceQuality: (gate.evidence_quality as any) ?? null,
          sectionSourceStatuses: (gate.section_source_statuses as any) ?? [],
          contradictionChecklist: (gate.contradiction_checklist as any) ?? [],
          evidenceRows: evidence,
          subject: subj ? { company_name: subj.company_name ?? null, website: subj.website ?? null } : null,
        })
      : [];

    // SPEC-BIE-SOURCE-SNAPSHOT-LEDGER-AND-OFFICIAL-SOURCE-CONNECTORS-1: attach the
    // persisted evidence-collection tasks to each blocker by blocker_id.
    // SPEC-BIE-COMMITTEE-EVIDENCE-COLLECTION-FROM-BLOCKERS-1: enrich each task by
    // linking it to the actual loan file (documents / facts / story / management)
    // and deriving a real status (missing/collected/needs_review) — derived-on-
    // read, no persistence change, never touches gate scoring or committee state.
    // SPEC-BIE-COMMITTEE-EVIDENCE-REQUIREMENTS-ENGINE-1: proactive required-
    // evidence plan. Computed whenever a mission exists (NOT gated on gate
    // failure) so predictable committee blockers surface as requirement gaps
    // early. Pure / derived-on-read; never changes gate or committee state.
    let committee_requirements_plan: CommitteeRequirementsPlan | null = null;
    let committee_source_candidates: SourceCandidatePlan | null = null;
    // SPEC-BIE-COMMITTEE-READINESS-FINALIZATION-MEGA-1: read-only impact preview,
    // transition eligibility, and the committee readiness section. NO mutation.
    let committee_blocker_impact_preview: CommitteeBlockerImpactPreview | null = null;
    let committee_transition_result: CommitteeReadinessTransitionResult | null = null;
    let committee_readiness_section: CommitteeReadinessSection | null = null;
    // SPEC-BIE-DERIVATION-AUDIT-AND-EVIDENCE-PROMOTION-1: classify the evidence
    // already on the deal so narratives can promote borrower/file support.
    let committee_decision_evidence: DecisionEvidenceProjection | null = null;
    let research_fact_projection: ResearchFactProjection | null = null;

    if (mission?.id) {
      const subjAny = (subj ?? {}) as Record<string, any>;
      const tasks = await loadCommitteeTasks(sb, mission.id);
      const [docsRes, factsRes, storyRes, mgmtRes, loanRes, snapsRes] = await Promise.all([
        sb.from("deal_documents")
          .select("id, canonical_type, document_type, original_filename, status")
          .eq("deal_id", dealId).neq("is_active", false),
        sb.from("deal_financial_facts")
          .select("fact_key, fact_type")
          .eq("deal_id", dealId).neq("is_superseded", true),
        sb.from("deal_borrower_story")
          .select("products_services, customer_concentration, competitive_position, website, hq_city, hq_state, legal_name, dba, business_description, growth_strategy, key_risks, customers")
          .eq("deal_id", dealId).maybeSingle(),
        sb.from("deal_management_profiles")
          .select("id, person_name, title, source")
          .eq("deal_id", dealId),
        sb.from("deal_loan_requests")
          .select("product_type, requested_amount, collateral_summary, property_type, purpose, loan_purpose, use_of_proceeds")
          .eq("deal_id", dealId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        sb.from("buddy_research_source_snapshots")
          .select("source_type, status")
          .eq("mission_id", mission.id),
      ]);

      const linkInput = {
        evidenceRows: evidence,
        documents: docsRes.data ?? [],
        financialFacts: factsRes.data ?? [],
        borrowerStory: (storyRes.data as any) ?? null,
        managementProfiles: mgmtRes.data ?? [],
        subject: subj ? { website: subj.website ?? null } : null,
      };

      // Enrichment + durable persistence — only when there are resolutions/tasks
      // (unchanged behavior from #483/#484/persist PR).
      if (gate && committee_blocker_resolutions.length > 0 && tasks.length > 0) {
        const enrichedBase = enrichCommitteeTasks(tasks, linkInput);
        try {
          await persistEnrichedCommitteeTasks(sb, enrichedBase);
        } catch {
          /* non-fatal: response still uses the freshly derived enrichment */
        }
        // SPEC-BIE-SOURCE-SNAPSHOT-TO-LOAN-FILE-ARTIFACT-1: attach a banker-
        // openable view URL for any captured loan-file artifact.
        // SPEC-…-ACTION-CENTER-AND-OFFICIAL-PDF-CAPTURE-1: also attach the
        // official-capture provenance so the card can distinguish a usable
        // official capture from a search-form/receipt-only one and gate buttons.
        const artifactIds = enrichedBase
          .map((t) => t.source_artifact_id)
          .filter((v): v is string => !!v);
        const captureById = new Map<string, any>();
        if (artifactIds.length > 0) {
          const { data: artRows } = await sb
            .from("buddy_research_source_artifacts")
            .select("id, official_capture_available, official_capture_status, official_capture_format, receipt_pdf_available")
            .in("id", artifactIds);
          for (const a of (artRows as any[]) ?? []) captureById.set(a.id, a);
        }
        const enriched = enrichedBase.map((t) => {
          if (!t.source_artifact_id) return t;
          const base = `/api/deals/${dealId}/research/source-artifact?artifact_id=${t.source_artifact_id}`;
          const cap = captureById.get(t.source_artifact_id);
          return {
            ...t,
            artifact_view_url: base,
            receipt_view_url: `${base}&format=pdf`,
            official_capture_available: cap?.official_capture_available ?? false,
            official_capture_status: cap?.official_capture_status ?? "none",
            official_capture_format: cap?.official_capture_format ?? "none",
            official_capture_view_url: cap?.official_capture_available ? `${base}&format=official` : null,
          };
        });
        committee_blocker_resolutions = committee_blocker_resolutions.map((r) => ({
          ...r,
          evidence_tasks: enriched.filter((t) => t.blocker_id === r.blocker_id),
        }));
      }

      const loan = (loanRes.data as any) ?? {};
      const story = (storyRes.data as any) ?? {};
      committee_requirements_plan = buildCommitteeRequirementsPlan({
        ...linkInput,
        loanType: loan.product_type ?? null,
        loanAmount: loan.requested_amount != null ? Number(loan.requested_amount) : null,
        collateralType: loan.collateral_summary ?? loan.property_type ?? null,
        useOfProceeds: loan.purpose ?? loan.loan_purpose ?? null,
        hasStructuredLoanRequest: !!(loan.use_of_proceeds && Object.keys(loan.use_of_proceeds).length > 0),
        naicsCode: subjAny.naics_code ?? null,
        naicsDescription: subjAny.naics_description ?? null,
        isPrivate: true,
        hqCity: story.hq_city ?? null,
        hqState: story.hq_state ?? null,
        legalName: subjAny.company_name ?? story.legal_name ?? null,
        dba: story.dba ?? null,
        sourceSnapshots: (snapsRes.data as any) ?? [],
        committeeTasks: tasks as any,
      });

      // SPEC-BIE-OFFICIAL-SOURCE-CONNECTOR-FRAMEWORK-1: Buddy-native official/free
      // source candidates (registry/SOS, gov data, adverse plan, competitor) so
      // each committee task shows the collection path BEFORE the gate fails.
      // Pure aggregation — no fetch, no persist, no auto-clear.
      committee_source_candidates = buildSourceCandidatePlan({
        naicsCode: subjAny.naics_code ?? null,
        naicsDescription: subjAny.naics_description ?? null,
        hqCity: story.hq_city ?? null,
        hqState: story.hq_state ?? null,
        loanType: loan.product_type ?? null,
        legalName: subjAny.company_name ?? story.legal_name ?? null,
        dba: story.dba ?? null,
        principals: (mgmtRes.data as any) ?? [],
        competitiveRows: evidence.filter((e) => e.thread_origin === "competitive"),
      });

      // SPEC-BIE-COMMITTEE-READINESS-FINALIZATION-MEGA-1: read-only impact +
      // transition preview + committee readiness section. Never mutates the gate,
      // tasks, trust grade, or committee_eligible.
      if (gate) {
        committee_blocker_impact_preview = buildCommitteeBlockerImpactPreview({
          missionId: mission.id,
          dealId,
          generatedAt: new Date().toISOString(),
          gate: {
            trust_grade: gate.trust_grade,
            gate_passed: gate.gate_passed,
            preliminary_eligible: gate.preliminary_eligible,
            committee_eligible: gate.committee_eligible,
            committee_blockers: (gate.committee_blockers as string[]) ?? [],
          },
          resolutions: committee_blocker_resolutions,
          requirementsPlan: committee_requirements_plan,
          tasks: tasks as any,
        });
        committee_transition_result = evaluateCommitteeReadinessTransition({
          preview: committee_blocker_impact_preview,
          gate: {
            trust_grade: gate.trust_grade,
            preliminary_eligible: gate.preliminary_eligible,
            committee_eligible: gate.committee_eligible,
            committee_blockers: (gate.committee_blockers as string[]) ?? [],
          },
          tasks: tasks as any,
        });
        committee_readiness_section = buildCommitteeReadinessSection(
          committee_blocker_impact_preview,
          committee_transition_result,
          tasks as any,
        );
      }

      // SPEC-BIE-DERIVATION-AUDIT-AND-EVIDENCE-PROMOTION-1: classify the evidence
      // already loaded above (no new query, no schema) into explicit classes +
      // a research fact projection, so narratives can promote borrower/file
      // support instead of bluntly labelling it "missing".
      const privateCompanyEvidenceMode =
        (gate?.evidence_quality as any)?.private_company_evidence_mode === true ||
        gate?.preliminary_basis === "banker_certified_private_company";
      const projectionInput = {
        financialFactKeys: ((factsRes.data as any[]) ?? []).map((f) => String(f.fact_key)),
        borrowerStory: (storyRes.data as any) ?? null,
        loan,
        managementProfiles: (mgmtRes.data as any[]) ?? [],
        naicsCode: subjAny.naics_code ?? null,
        naicsDescription: subjAny.naics_description ?? null,
        sourceSnapshots: (snapsRes.data as any[]) ?? [],
        committeeTasks: tasks as any,
        privateCompanyEvidenceMode,
        managementValidationPass: gate?.management_validation_check === "pass" || gate?.management_validation_check === true,
        principalsConfirmed: typeof gate?.principals_confirmed === "number" ? gate.principals_confirmed : 0,
        // SPEC-SCALE-PLAUSIBILITY-RECONCILIATION-1: gate-derived scale blocker state.
        contradictionChecklist: (gate?.contradiction_checklist as any[]) ?? [],
        committeeBlockers: (gate?.committee_blockers as string[]) ?? [],
      };
      committee_decision_evidence = buildDecisionEvidenceProjection(projectionInput);
      research_fact_projection = buildResearchFactProjection(projectionInput);
    }

    return NextResponse.json({
      ok: true,
      committee_blocker_resolutions,
      committee_requirements_plan,
      committee_source_candidates,
      committee_blocker_impact_preview,
      committee_transition_result,
      committee_readiness_section,
      committee_decision_evidence,
      research_fact_projection,
      gate: gate
        ? {
            trust_grade:                  gate.trust_grade,
            gate_passed:                  gate.gate_passed,
            quality_score:                gate.quality_score,
            evaluated_at:                 gate.evaluated_at,
            entity_lock_check:            gate.entity_lock_check,
            entity_confidence:            gate.entity_confidence,
            thread_coverage_check:        gate.thread_coverage_check,
            threads_succeeded:            gate.threads_succeeded,
            threads_failed:               gate.threads_failed,
            source_diversity_check:       gate.source_diversity_check,
            source_count:                 gate.source_count,
            management_validation_check:  gate.management_validation_check,
            principals_confirmed:         gate.principals_confirmed,
            principals_unconfirmed:       gate.principals_unconfirmed,
            synthesis_check:              gate.synthesis_check,
            contradictions_found:         gate.contradictions_found,
            underwriting_questions_found: gate.underwriting_questions_found,
            gate_failures:                gate.gate_failures ?? [],
            thread_results:               gate.thread_results ?? {},
            // SPEC-BIE-SAFE-PRIVATE-COMPANY-RESEARCH-HARDENING-1 Phases 3–6.
            section_source_statuses:      gate.section_source_statuses ?? [],
            contradiction_checklist:      gate.contradiction_checklist ?? [],
            evidence_quality:             gate.evidence_quality ?? null,
            preliminary_eligible:         gate.preliminary_eligible ?? false,
            committee_eligible:           gate.committee_eligible ?? false,
            preliminary_basis:            gate.preliminary_basis ?? null,
            committee_blockers:           gate.committee_blockers ?? [],
          }
        : null,
      evidence_summary: {
        total_claims: evidence.length,
        by_thread:    byThread,
      },
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "unexpected_error" },
      { status: 500 },
    );
  }
}
