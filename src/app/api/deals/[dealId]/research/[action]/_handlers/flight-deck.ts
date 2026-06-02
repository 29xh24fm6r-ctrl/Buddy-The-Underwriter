import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadTrustGradeForDeal } from "@/lib/research/trustEnforcement";
import { buildResearchEntityProfile } from "@/lib/research/buildResearchSubject";
import { validateSubjectLock } from "@/lib/research/subjectLock";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

export const runtime = "nodejs";
// Spec D5: cockpit-supporting GET routes must allow headroom beyond the
// 10s default for cold-start auth + multi-step Supabase I/O.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

type RecoveryAction = {
  label: string;
  actionApi: string | null;
  actionMethod: "POST" | null;
  priority: "critical" | "high" | "medium";
};

// SPEC-RESEARCH-GATE-PRIVATE-BORROWER-AND-EVIDENCE-PACK-1: grouped action cards.
type GroupItem = {
  label: string;
  meaning: string;
  status: "missing" | "present" | "advisory";
  actionApi: string | null;
  blocksPreliminary: boolean;
  blocksCommittee: boolean;
};
type ResearchGateGroups = {
  requiredIdentityInputs: GroupItem[];
  researchQualityIssues: GroupItem[];
  bankerCertifiedEvidence: GroupItem[];
};

/**
 * GET /api/deals/[dealId]/research/flight-deck
 *
 * Phase 81: Human review flight deck — shows bankers exactly what to fix
 * when a memo is blocked from committee status.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
    }

    const sb = supabaseAdmin();

    // Parallel data loads.
    // SPEC-RESEARCH-SUBJECT-LOCK-MEMO-INPUT-PARITY-1: the subject lock is derived
    // from the canonical builder (memo-input parity) instead of a borrowers-only
    // read gated on the legacy borrower_id, so the flight deck agrees with
    // research/run and with lifecycle/underwrite.
    // SPEC-MEMO-INPUTS-IDENTITY-NAICS-RERUN-FRESHNESS-1: select the LATEST mission
    // deterministically by created_at (queued/running missions have null
    // completed_at), and read the gate that belongs to THAT mission — never a
    // stale global latest-by-evaluated_at gate from an older run.
    const [trustGrade, missionRes, subjectRes] = await Promise.all([
      loadTrustGradeForDeal(dealId),
      (sb as any)
        .from("buddy_research_missions")
        .select("id, status, completed_at, created_at")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      buildResearchEntityProfile(sb, dealId),
    ]);

    const mission = missionRes?.data;
    const profile = subjectRes;
    const { subject, naics_provisional } = profile;

    const missionInProgress = mission?.status === "queued" || mission?.status === "running";

    // Gate tied to the latest mission. While a newer mission is in progress, do
    // not surface the previous mission's gate (the source of the stale
    // research_failed display).
    const gateRes = mission && !missionInProgress
      ? await (sb as any)
          .from("buddy_research_quality_gates")
          .select("trust_grade, quality_score, gate_failures, threads_failed, source_count, contradictions_found")
          .eq("mission_id", mission.id)
          .order("evaluated_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : { data: null };
    const gate = gateRes?.data;

    // Compute blockers and recovery actions
    const blockers: string[] = [];
    const actions: RecoveryAction[] = [];

    // Subject lock — run the canonical validator over the built subject.
    const lock = validateSubjectLock({
      company_name: subject.company_name,
      naics_code: subject.naics_code,
      naics_description: subject.naics_description,
      business_description: subject.business_description,
      city: subject.city,
      state: subject.state,
      geography: subject.geography,
      website: subject.website,
      dba: subject.dba,
      banker_summary: subject.banker_summary,
      banker_override: subject.banker_override,
    });

    if (!lock.ok) {
      for (const reason of lock.reasons) {
        if (!blockers.includes(reason)) blockers.push(reason);
        if (reason.includes("legal name")) {
          actions.push({ label: "Complete Intake", actionApi: `/deals/${dealId}/memo-inputs`, actionMethod: null, priority: "critical" });
        }
      }
    }

    // NAICS: when there is no real NAICS *number*, surface a precise, actionable
    // advisory — NOT a hard "research cannot identify borrower" failure. The
    // wording depends on whether an industry description is already available:
    //   - description present → "NAICS code not set — industry description is
    //     available" (high-priority advisory; the subject lock still clears)
    //   - nothing at all      → "Set industry classification / NAICS"
    // Both deep-link to the memo-input Borrower Story section, where industry /
    // NAICS context is now editable (SPEC-MEMO-INPUTS-INDUSTRY-CLASSIFICATION-FIELD-1).
    if (naics_provisional) {
      const hasIndustryDesc = (subject.naics_description ?? "").trim().length > 0;
      const advisory = hasIndustryDesc
        ? "NAICS code not set — industry description is available"
        : "Set industry classification / NAICS";
      if (!blockers.includes(advisory)) blockers.push(advisory);
      actions.push({
        label: "Set industry classification / NAICS",
        actionApi: `/deals/${dealId}/memo-inputs#borrower-story`,
        actionMethod: null,
        priority: lock.ok ? "high" : "critical",
      });
    }

    // Research status. SPEC-MEMO-INPUTS-IDENTITY-NAICS-RERUN-FRESHNESS-1: when a
    // newer mission is queued/running, say so explicitly and DO NOT surface the
    // previous mission's trust grade / gate failures as if they were current.
    if (!mission) {
      blockers.push("Research not yet run");
      actions.push({ label: "Run Research", actionApi: `/api/deals/${dealId}/research/run`, actionMethod: "POST", priority: "critical" });
    } else if (missionInProgress) {
      blockers.push("Research in progress — re-running with the latest inputs");
    } else if (mission.status === "failed" || mission.status === "error") {
      blockers.push("Research mission failed");
      actions.push({ label: "Re-run Research", actionApi: `/api/deals/${dealId}/research/run`, actionMethod: "POST", priority: "critical" });
    }

    // Trust grade — only meaningful for a settled (not in-progress) latest mission.
    if (!missionInProgress && trustGrade && trustGrade !== "committee_grade") {
      blockers.push(`Research trust grade: ${trustGrade}`);
      if (trustGrade === "research_failed") {
        actions.push({ label: "Re-run Research", actionApi: `/api/deals/${dealId}/research/run`, actionMethod: "POST", priority: "critical" });
      }
    }

    // Gate failures
    if (Array.isArray(gate?.gate_failures)) {
      for (const f of gate.gate_failures as any[]) {
        const reason = typeof f === "string" ? f : f?.reason ?? f?.gate_id;
        if (reason && !blockers.includes(reason)) {
          blockers.push(reason);
        }
      }
    }

    // Contradiction gaps
    if ((gate?.contradictions_found ?? 0) === 0 && mission?.status === "complete") {
      blockers.push("No contradictions analyzed — adversarial review incomplete");
    }

    // Always offer memo rebuild
    actions.push({ label: "Rebuild Memo", actionApi: `/api/deals/${dealId}/credit-memo/generate`, actionMethod: "POST", priority: "medium" });

    // SPEC-RESEARCH-GATE-PRIVATE-BORROWER-AND-EVIDENCE-PACK-1: grouped action
    // cards so /underwrite shows what to fix instead of an opaque failure dump.
    const memoInputs = `/deals/${dealId}/memo-inputs`;
    const idItem = (
      label: string,
      present: boolean,
      meaning: string,
      blocksCommittee: boolean,
      blocksPreliminary = false,
      anchor = "#entity-identity",
    ): GroupItem => ({
      label,
      meaning,
      status: present ? "present" : blocksPreliminary ? "missing" : "advisory",
      actionApi: present ? null : `${memoInputs}${anchor}`,
      blocksPreliminary,
      blocksCommittee,
    });

    const requiredIdentityInputs: GroupItem[] = [
      idItem(
        "Legal borrower name",
        !!profile.legal_name || (!profile.name_is_placeholder && !!subject.company_name),
        "The exact entity research verifies — without it, research won't search the deal name.",
        true,
        profile.name_is_placeholder, // blocks preliminary only when nothing else identifies the entity
      ),
      idItem("DBA / trade name", !!profile.dba, "Helps disambiguate similarly-named entities.", false),
      idItem("Website", !!profile.website, "A strong public identity anchor.", false),
      idItem(
        "HQ location",
        !!(profile.hq_city || profile.hq_state),
        "Anchors market and competitive research.",
        false,
      ),
      idItem(
        "Industry / NAICS",
        !naics_provisional,
        naics_provisional
          ? "Industry description is available; the 6-digit NAICS improves precision."
          : "NAICS on file.",
        true,
        false,
        "#borrower-story",
      ),
    ];

    const researchQualityIssues: GroupItem[] = [];
    const qItem = (label: string, meaning: string, blocksCommittee: boolean): GroupItem => ({
      label, meaning, status: "missing", actionApi: null, blocksPreliminary: false, blocksCommittee,
    });
    // SPEC-MEMO-INPUTS-IDENTITY-NAICS-RERUN-FRESHNESS-1: while a newer mission is
    // running, show progress — not the previous mission's failures.
    if (missionInProgress) {
      researchQualityIssues.push({
        label: "Research in progress",
        meaning: "Re-running with the latest identity / NAICS inputs. Results will refresh when complete.",
        status: "advisory",
        actionApi: null,
        blocksPreliminary: false,
        blocksCommittee: false,
      });
    }
    if (!missionInProgress && Array.isArray(gate?.gate_failures)) {
      for (const f of gate.gate_failures as any[]) {
        const reason = typeof f === "string" ? f : f?.reason ?? f?.gate_id;
        if (reason) researchQualityIssues.push(qItem(String(reason), "Surfaced by the research quality gate.", true));
      }
    }
    if (!missionInProgress && trustGrade && trustGrade !== "committee_grade") {
      researchQualityIssues.push(qItem(`Trust grade: ${trustGrade}`, "Committee-grade requires public confirmation + source thresholds.", true));
    }

    const bankerCertifiedEvidence: GroupItem[] = [
      { label: "Borrower story", meaning: "Banker-certified business narrative.", status: subject.business_description ? "present" : "missing", actionApi: subject.business_description ? null : `${memoInputs}#borrower-story`, blocksPreliminary: false, blocksCommittee: false },
      { label: "Management profile", meaning: "Principals on file (deal_management_profiles).", status: (subject.principals?.length ?? 0) > 0 ? "present" : "missing", actionApi: (subject.principals?.length ?? 0) > 0 ? null : memoInputs, blocksPreliminary: false, blocksCommittee: false },
      { label: "Financials", meaning: "Revenue / cash-flow facts extracted.", status: subject.annual_revenue != null ? "present" : "missing", actionApi: null, blocksPreliminary: false, blocksCommittee: false },
      { label: "Banker identity summary", meaning: "Banker's certified description of who the borrower is.", status: profile.banker_identity_summary ? "present" : "missing", actionApi: profile.banker_identity_summary ? null : `${memoInputs}#entity-identity`, blocksPreliminary: false, blocksCommittee: false },
    ];

    const groups: ResearchGateGroups = {
      requiredIdentityInputs,
      researchQualityIssues,
      bankerCertifiedEvidence,
    };

    return NextResponse.json({
      ok: true,
      trustGrade,
      isCommitteeEligible: trustGrade === "committee_grade" && blockers.length === 0,
      qualityScore: gate?.quality_score ?? null,
      // Subject lock now reflects the canonical validator (memo-input parity).
      // A provisional NAICS is an advisory, not a lock failure.
      subjectLocked: lock.ok,
      naicsProvisional: naics_provisional,
      certificationLevel: profile.certification_level,
      nameIsPlaceholder: profile.name_is_placeholder,
      researchInProgress: missionInProgress,
      groups,
      blockers,
      actions,
      borrower: {
        legal_name: subject.company_name ?? null,
        naics_code: subject.naics_code ?? null,
        naics_description: subject.naics_description ?? null,
        business_description: subject.business_description ?? null,
        city: subject.city ?? null,
        state: subject.state ?? null,
      },
      research: {
        status: mission?.status ?? null,
        completed_at: mission?.completed_at ?? null,
        threads_failed: gate?.threads_failed ?? null,
        source_count: gate?.source_count ?? null,
      },
    });
  } catch (e: any) {
    rethrowNextErrors(e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
