import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadTrustGradeForDeal } from "@/lib/research/trustEnforcement";
import { buildResearchEntityProfile } from "@/lib/research/buildResearchSubject";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

type BlockerKey =
  | "missing_naics"
  | "missing_geography"
  | "missing_business_description"
  | "missing_identifying_anchor"
  | "malformed_principal"
  | "placeholder_deal_name"
  | "missing_entity_search_name"
  | "research_failed"
  | "manual_review_required"
  | "research_not_run";

type Blocker = {
  key: BlockerKey;
  severity: "error" | "warn";
  label: string;
  detail: string;
};

type Ctx = { params: Promise<{ dealId: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
    }

    const sb = supabaseAdmin();

    const [dealRes, missionRes, trustGrade, overridesRes] = await Promise.all([
      (sb as any)
        .from("deals")
        .select("id, display_name, nickname, borrower_name, borrower_id")
        .eq("id", dealId)
        .maybeSingle(),
      (sb as any)
        .from("buddy_research_missions")
        .select("id, status, trust_grade")
        .eq("deal_id", dealId)
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      loadTrustGradeForDeal(dealId),
      (sb as any)
        .from("deal_memo_overrides")
        .select("overrides")
        .eq("deal_id", dealId)
        .eq("bank_id", access.bankId)
        .maybeSingle(),
    ]);

    const deal = dealRes.data;
    const mission = missionRes.data;
    const overrides = (overridesRes.data?.overrides ?? {}) as Record<string, unknown>;

    // Borrower
    let borrower: {
      legal_name: string | null;
      naics_code: string | null;
      naics_description: string | null;
      city: string | null;
      state: string | null;
    } | null = null;

    if (deal?.borrower_id) {
      const { data: b } = await (sb as any)
        .from("borrowers")
        .select("legal_name, naics_code, naics_description, city, state")
        .eq("id", deal.borrower_id)
        .maybeSingle();
      borrower = b ?? null;
    }

    // Ownership entities — flag malformed
    const { data: ownersData } = await (sb as any)
      .from("ownership_entities")
      .select("id, display_name, title, ownership_pct")
      .eq("deal_id", dealId)
      .limit(20);

    const MALFORMED_PATTERNS = /\n|\r|\t|Taxpayer address|taxpayer|undefined|null/i;

    const principals = ((ownersData ?? []) as any[]).map((o: any) => {
      const raw = String(o.display_name ?? "").trim();
      const isMalformed = MALFORMED_PATTERNS.test(raw) || raw.length < 2;
      const normalized = raw.split(/\n/)[0].trim()
        .replace(/\s+/g, " ")
        .replace(/Taxpayer.*$/i, "")
        .trim();
      return {
        id: String(o.id),
        displayName: raw,
        isMalformed,
        normalizedCandidate: isMalformed && normalized.length > 2 ? normalized : null,
      };
    });

    // ── Blocker list ────────────────────────────────────────────────────────
    const blockers: Blocker[] = [];

    // SPEC-NAICS-TOOL-MEMO-INPUTS-INTEGRATION-1: read industry/NAICS from the
    // canonical research subject builder (borrowers row first, then
    // deal_borrower_story NAICS/industry fields) so this agrees with the research
    // subject lock and the flight deck. Missing numeric NAICS with a meaningful
    // industry description is a WARN advisory, not a critical subject-lock failure.
    const researchProfile = await buildResearchEntityProfile(sb, dealId);
    const researchSubject = researchProfile.subject;
    const hasNumericNaics =
      !!researchSubject.naics_code && researchSubject.naics_code !== "999999";
    const hasIndustryDesc = (researchSubject.naics_description ?? "").trim().length > 0;

    // SPEC-RESEARCH-GATE-PRIVATE-BORROWER-AND-EVIDENCE-PACK-1: a placeholder deal
    // label is not a searchable legal entity. Ask for the exact identity inputs
    // instead of letting research conclude the entity is nonexistent.
    if (researchProfile.name_is_placeholder) {
      blockers.push({
        key: "missing_entity_search_name",
        severity: "error",
        label: "Legal borrower name needed",
        detail: "The deal name is a placeholder. Add the legal borrower name / DBA / website in Memo Inputs → Entity Identity so research can verify the right company.",
      });
    }

    if (!hasNumericNaics) {
      blockers.push({
        key: "missing_naics",
        severity: hasIndustryDesc ? "warn" : "error",
        label: hasIndustryDesc ? "NAICS code not set" : "Industry not identified",
        detail: hasIndustryDesc
          ? "Industry description is available — research can run, but adding the 6-digit NAICS code improves precision. Set it in Memo Inputs → Borrower Story."
          : "No industry code or description on file — BIE cannot run industry or competitive research. Set it in Memo Inputs → Borrower Story.",
      });
    }
    const hasNaics = hasNumericNaics;

    const hasGeo = !!(borrower?.city?.trim() || borrower?.state?.trim());
    if (!hasGeo) {
      blockers.push({
        key: "missing_geography",
        severity: "error",
        label: "No market location",
        detail: "City and state are missing — BIE cannot run market or competitive research.",
      });
    }

    const hasDesc = typeof overrides.business_description === "string" &&
      (overrides.business_description as string).trim().length > 20;
    if (!hasDesc) {
      blockers.push({
        key: "missing_business_description",
        severity: "warn",
        label: "Business description missing",
        detail: "Adding a plain-English description dramatically improves research quality.",
      });
    }

    const hasBankerSummary = typeof overrides.banker_summary === "string" &&
      (overrides.banker_summary as string).trim().length > 20;
    const hasWebsite = typeof overrides.website === "string" &&
      (overrides.website as string).trim().length > 5;
    if (!hasBankerSummary && !hasWebsite && !hasDesc) {
      blockers.push({
        key: "missing_identifying_anchor",
        severity: "warn",
        label: "No identifying anchor",
        detail: "A website URL or brief banker summary helps BIE find the right entity.",
      });
    }

    const malformedPrincipals = principals.filter(p => p.isMalformed);
    if (malformedPrincipals.length > 0) {
      blockers.push({
        key: "malformed_principal",
        severity: "warn",
        label: `${malformedPrincipals.length} owner record${malformedPrincipals.length > 1 ? "s need" : " needs"} cleanup`,
        detail: `Malformed name(s): ${malformedPrincipals.map(p => p.displayName.slice(0, 40)).join(", ")}.`,
      });
    }

    const dealName = deal?.display_name || deal?.nickname || deal?.borrower_name || "";
    const PLACEHOLDER_PATTERNS = /^(chatgpt|fix|test|deal \d|new deal|untitled|draft)/i;
    if (PLACEHOLDER_PATTERNS.test(dealName.trim())) {
      blockers.push({
        key: "placeholder_deal_name",
        severity: "warn",
        label: "Placeholder deal name",
        detail: `"${dealName}" looks like a test name — rename it.`,
      });
    }

    if (!mission) {
      blockers.push({
        key: "research_not_run",
        severity: "warn",
        label: "Research not yet run",
        detail: "No intelligence has been gathered for this deal.",
      });
    } else if (trustGrade === "research_failed") {
      blockers.push({
        key: "research_failed",
        severity: "error",
        label: "Research failed",
        detail: "The last run could not confirm the entity. Resolve blockers above and re-run.",
      });
    } else if (trustGrade === "manual_review_required") {
      blockers.push({
        key: "manual_review_required",
        severity: "warn",
        label: "Research needs manual review",
        detail: "Research completed with gaps. Adding more context and re-running may improve trust grade.",
      });
    }

    const criticalBlockers = blockers.filter(b => b.severity === "error");

    // suggestedActions (ChatGPT Sprint 2 shape)
    const suggestedActions: Array<{ key: string; label: string }> = [];
    if (!hasNaics) suggestedActions.push({ key: "set_naics", label: "Set industry code" });
    if (!hasGeo) suggestedActions.push({ key: "set_geography", label: "Add location" });
    if (malformedPrincipals.length > 0) suggestedActions.push({ key: "fix_principals", label: "Clean up owner records" });
    if (!hasDesc) suggestedActions.push({ key: "add_description", label: "Describe the business" });
    suggestedActions.push({ key: "run_research", label: "Run research" });

    return NextResponse.json({
      ok: true,
      deal: {
        id: String(deal?.id ?? dealId),
        name: dealName || null,
        borrowerId: deal?.borrower_id ?? null,
        borrowerName: deal?.borrower_name ?? null,
      },
      blockers,
      hasCriticalBlockers: criticalBlockers.length > 0,
      // Trigger wizard for critical blockers OR manual_review_required
      // manual_review_required after research has run is an Intelligence tab concern,
      // not a wizard concern. Only show wizard for that grade if research hasn't run yet.
      shouldShowWizard: criticalBlockers.length > 0 ||
        (trustGrade === "manual_review_required" && !mission),
      isReadyForResearch: criticalBlockers.length === 0,
      borrower: {
        legalName: borrower?.legal_name ?? researchSubject.company_name ?? null,
        // Prefer a real numeric NAICS; the builder merges borrowers + story.
        naicsCode: hasNumericNaics ? researchSubject.naics_code ?? null : borrower?.naics_code ?? null,
        naicsDescription: researchSubject.naics_description ?? borrower?.naics_description ?? null,
        city: borrower?.city ?? null,
        state: borrower?.state ?? null,
        // website has no borrowers column — read from overrides
        website: typeof overrides.website === "string" ? overrides.website : null,
      },
      principals,
      overrides,
      suggestedActions,
      trustGrade,
      researchStatus: mission?.status ?? null,
    });
  } catch (e: any) {
    rethrowNextErrors(e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
