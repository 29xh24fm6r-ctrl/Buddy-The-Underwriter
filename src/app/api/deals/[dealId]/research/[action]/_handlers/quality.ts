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
    if (gate && mission?.id && committee_blocker_resolutions.length > 0) {
      const tasks = await loadCommitteeTasks(sb, mission.id);
      if (tasks.length > 0) {
        const [docsRes, factsRes, storyRes, mgmtRes] = await Promise.all([
          sb.from("deal_documents")
            .select("id, canonical_type, document_type, document_category, original_filename, status")
            .eq("deal_id", dealId).neq("is_active", false),
          sb.from("deal_financial_facts")
            .select("fact_key, fact_type")
            .eq("deal_id", dealId).neq("is_superseded", true),
          sb.from("deal_borrower_story")
            .select("products_services, customer_concentration, competitive_position, website")
            .eq("deal_id", dealId).maybeSingle(),
          sb.from("deal_management_profiles")
            .select("id, person_name, title, source")
            .eq("deal_id", dealId),
        ]);
        const enriched = enrichCommitteeTasks(tasks, {
          evidenceRows: evidence,
          documents: docsRes.data ?? [],
          financialFacts: factsRes.data ?? [],
          borrowerStory: storyRes.data ?? null,
          managementProfiles: mgmtRes.data ?? [],
          subject: subj ? { website: subj.website ?? null } : null,
        });
        // SPEC-BIE-PERSIST-COMMITTEE-EVIDENCE-TASK-STATUS-1: make the derived
        // status durable so Supabase agrees with the UI. Non-fatal — a failed
        // write must never break the read.
        try {
          await persistEnrichedCommitteeTasks(sb, enriched);
        } catch {
          /* non-fatal: response still uses the freshly derived enrichment */
        }
        committee_blocker_resolutions = committee_blocker_resolutions.map((r) => ({
          ...r,
          evidence_tasks: enriched.filter((t) => t.blocker_id === r.blocker_id),
        }));
      }
    }

    return NextResponse.json({
      ok: true,
      committee_blocker_resolutions,
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
