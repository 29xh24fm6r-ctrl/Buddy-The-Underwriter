/**
 * SPEC-RESEARCH-SUBJECT-LOCK-MEMO-INPUT-PARITY-1
 *
 * Canonical research subject builder. Single source of truth for the
 * MissionSubject passed to runMission and re-derived in the research
 * flight deck. Brings research into parity with the borrower-representation
 * contract (src/lib/borrower/borrowerRepresentation.ts) that lifecycle and
 * underwrite already share.
 *
 * The legacy research path read ONLY `borrowers` (gated on deals.borrower_id)
 * + `ownership_entities`. When borrower_id is null (the common case once the
 * Attach Borrower flow writes deal_borrower_story / deal_management_profiles
 * instead of the FK), every subject field came back empty and the pre-research
 * subject lock failed with "borrower legal name missing / business description
 * missing / no identifying anchor" — even though Buddy held complete,
 * banker-certified memo-input context.
 *
 * This module resolves the subject from the SAME sources that determine
 * borrower representation, so research can never disagree with lifecycle/
 * underwrite again.
 *
 * Intentionally NOT "server-only": `assembleResearchSubject` is pure and
 * unit-testable; the async loader takes the Supabase client as a parameter
 * (same pattern as hasBorrowerRepresentation).
 */

import { borrowerIsRepresented } from "@/lib/borrower/borrowerRepresentation";
import type { MissionSubject } from "./types";

const PLACEHOLDER_NAICS = "999999";

// ─── Raw input (already-fetched rows) ────────────────────────────────────────

export type ResearchSubjectRaw = {
  borrowerId?: string | null;
  // deals
  dealBorrowerName?: string | null;
  dealDisplayName?: string | null;
  dealName?: string | null;
  dealState?: string | null;
  // borrowers row — null when no borrower_id or not found
  borrower?: {
    legal_name?: string | null;
    naics_code?: string | null;
    naics_description?: string | null;
    city?: string | null;
    state?: string | null;
  } | null;
  // memo-input borrower story (deal_borrower_story) — null when none
  story?: {
    business_description?: string | null;
    products_services?: string | null;
    revenue_model?: string | null;
    banker_notes?: string | null;
    competitive_position?: string | null;
    customers?: string | null;
    // SPEC-MEMO-INPUTS-INDUSTRY-CLASSIFICATION-FIELD-1: banker-entered industry /
    // NAICS context, used when no borrowers row is attached.
    industry_classification?: string | null;
    naics_code?: string | null;
    naics_description?: string | null;
  } | null;
  // memo-input management profiles (deal_management_profiles)
  managementProfiles?: Array<{
    person_name?: string | null;
    title?: string | null;
    ownership_pct?: number | null;
  }> | null;
  // entity participation model (ownership_entities) — preferred for principals
  ownershipEntities?: Array<{
    display_name?: string | null;
    title?: string | null;
  }> | null;
  // financial context (unchanged from legacy run.ts)
  annualRevenue?: number | null;
  loanAmount?: number | null;
  loanPurpose?: string | null;
};

export type AssembledResearchSubject = {
  subject: MissionSubject;
  /** Mirrors hasBorrowerRepresentation: borrower_id OR story OR management profile. */
  represented: boolean;
  /** True when there is no real NAICS number (missing or 999999). */
  naics_provisional: boolean;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function firstNonEmpty(...vals: Array<string | null | undefined>): string | null {
  for (const v of vals) {
    const t = (v ?? "").toString().trim();
    if (t.length > 0) return t;
  }
  return null;
}

/**
 * Derive a provisional industry description from banker-certified business
 * context. NEVER invents a NAICS *number* — only a human description that
 * satisfies the subject-lock's "industry identified" branch.
 */
function deriveProvisionalIndustry(
  story: ResearchSubjectRaw["story"],
): string | null {
  const basis = firstNonEmpty(story?.products_services, story?.business_description);
  if (!basis) return null;
  const firstClause = basis.split(/[.\n]/)[0].trim();
  const phrase = firstClause.length >= 6 ? firstClause : basis;
  return phrase.slice(0, 240);
}

/** Compose an identifying anchor from principal + company + business description. */
function composeAnchor(
  principals: Array<{ name: string }>,
  company: string | null,
  biz: string | null,
): string | null {
  const principal = principals[0]?.name ?? null;
  const head = [principal, company].filter((s): s is string => !!s && s.length > 0).join(" — ");
  const tail = (biz ?? "").trim();
  const out = [head, tail].filter((s) => s && s.length > 0).join(": ").trim();
  return out.length > 10 ? out : null;
}

// ─── Pure resolution ─────────────────────────────────────────────────────────

export function assembleResearchSubject(raw: ResearchSubjectRaw): AssembledResearchSubject {
  // Principals: ownership_entities first (entity participation model), else
  // management profiles (memo-input flow — where Matt-Hunt-style owners live).
  const ownerPrincipals = (raw.ownershipEntities ?? [])
    .map((o) => ({ name: (o.display_name ?? "").trim(), title: o.title ?? null }))
    .filter((p) => p.name.length > 1);
  const mgmtPrincipals = (raw.managementProfiles ?? [])
    .map((m) => ({ name: (m.person_name ?? "").trim(), title: m.title ?? null }))
    .filter((p) => p.name.length > 1);
  const principals = ownerPrincipals.length > 0 ? ownerPrincipals : mgmtPrincipals;

  const represented = borrowerIsRepresented({
    borrowerId: raw.borrowerId,
    managementProfileCount: (raw.managementProfiles ?? []).length,
    borrowerStoryCount: raw.story ? 1 : 0,
  });

  // Genuinely empty deal — return a minimal subject so the subject lock
  // correctly fails (name + industry are hard requirements).
  if (!represented) {
    return { subject: {}, represented: false, naics_provisional: true };
  }

  // 1. Company name — borrowers.legal_name (when attached) → deal name fields.
  const companyName = firstNonEmpty(
    raw.borrower?.legal_name,
    raw.dealBorrowerName,
    raw.dealDisplayName,
    raw.dealName,
  );

  // 2. Business description — from the banker-certified borrower story.
  const businessDescription = firstNonEmpty(
    raw.story?.business_description,
    raw.story?.products_services,
    raw.story?.revenue_model,
    raw.story?.banker_notes,
  );

  // 3/4. NAICS — never invent a number. Source order (SPEC-MEMO-INPUTS-INDUSTRY-
  // CLASSIFICATION-FIELD-1):
  //   1. borrowers.naics_code (canonical, only when a borrower row is attached)
  //   2. deal_borrower_story.naics_code (banker-entered on memo inputs)
  //   3. deal_borrower_story.naics_description / industry_classification (description)
  //   4. provisional description derived from business_description / products_services
  const candidateNaics = firstNonEmpty(raw.borrower?.naics_code, raw.story?.naics_code);
  const hasRealNaics = !!candidateNaics && candidateNaics !== PLACEHOLDER_NAICS;
  const naicsCode = hasRealNaics ? candidateNaics! : PLACEHOLDER_NAICS;
  const naicsProvisional = !hasRealNaics;

  let naicsDescription = firstNonEmpty(
    raw.borrower?.naics_description,
    raw.story?.naics_description,
    raw.story?.industry_classification,
  );
  if (!naicsDescription && naicsProvisional) {
    naicsDescription = deriveProvisionalIndustry(raw.story);
  }

  // 5. Identifying anchor — banker notes → competitive position → composed.
  const bankerSummary = firstNonEmpty(
    raw.story?.banker_notes,
    raw.story?.competitive_position,
    composeAnchor(principals, companyName, businessDescription),
  );

  // 6. Geography — borrower city/state → deal state → national default.
  const city = firstNonEmpty(raw.borrower?.city);
  const state = firstNonEmpty(raw.borrower?.state, raw.dealState);
  const geography = state ?? "US";

  const subject: MissionSubject = {
    naics_code: naicsCode,
    naics_description: naicsDescription ?? undefined,
    naics_provisional: naicsProvisional,
    geography,
    city: city ?? undefined,
    state: state ?? undefined,
    company_name: companyName ?? undefined,
    business_description: businessDescription,
    banker_summary: bankerSummary,
    principals,
    annual_revenue: raw.annualRevenue ?? null,
    loan_amount: raw.loanAmount ?? null,
    loan_purpose: raw.loanPurpose ?? null,
  };

  return { subject, represented: true, naics_provisional: naicsProvisional };
}

// ─── Async loader ──────────────────────────────────────────────────────────--

type MinimalSb = { from: (table: string) => any };

/**
 * Load every source the subject builder needs and assemble the MissionSubject.
 * Story / management reads are filtered by deal_id ONLY (no bank_id), matching
 * hasBorrowerRepresentation exactly so `represented` cannot diverge from the
 * lifecycle/underwrite borrower-representation contract.
 */
export async function buildResearchSubject(
  sb: MinimalSb,
  dealId: string,
): Promise<AssembledResearchSubject> {
  const { data: deal } = await sb
    .from("deals")
    .select("id, borrower_id, borrower_name, display_name, name, state")
    .eq("id", dealId)
    .maybeSingle();

  let borrower: ResearchSubjectRaw["borrower"] = null;
  if (deal?.borrower_id) {
    const { data } = await sb
      .from("borrowers")
      .select("legal_name, naics_code, naics_description, city, state")
      .eq("id", deal.borrower_id)
      .maybeSingle();
    borrower = data ?? null;
  }

  const [storyRes, mgmtRes, ownersRes, revRes, loanRes] = await Promise.all([
    sb
      .from("deal_borrower_story")
      .select(
        "business_description, products_services, revenue_model, banker_notes, competitive_position, customers, industry_classification, naics_code, naics_description",
      )
      .eq("deal_id", dealId)
      .maybeSingle(),
    sb
      .from("deal_management_profiles")
      .select("person_name, title, ownership_pct")
      .eq("deal_id", dealId)
      .order("ownership_pct", { ascending: false, nullsFirst: false }),
    sb
      .from("ownership_entities")
      .select("display_name, title")
      .eq("deal_id", dealId)
      .limit(10),
    sb
      .from("deal_financial_facts")
      .select("fact_value_num")
      .eq("deal_id", dealId)
      .eq("fact_key", "TOTAL_REVENUE")
      .not("fact_value_num", "is", null)
      .order("fact_period_end", { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb
      .from("deal_loan_requests")
      .select("purpose, loan_amount")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return assembleResearchSubject({
    borrowerId: deal?.borrower_id ?? null,
    dealBorrowerName: (deal as any)?.borrower_name ?? null,
    dealDisplayName: (deal as any)?.display_name ?? null,
    dealName: (deal as any)?.name ?? null,
    dealState: (deal as any)?.state ?? null,
    borrower,
    story: storyRes?.data ?? null,
    managementProfiles: (mgmtRes?.data ?? []) as ResearchSubjectRaw["managementProfiles"],
    ownershipEntities: (ownersRes?.data ?? []) as ResearchSubjectRaw["ownershipEntities"],
    annualRevenue: revRes?.data?.fact_value_num != null ? Number(revRes.data.fact_value_num) : null,
    loanAmount: loanRes?.data?.loan_amount != null ? Number(loanRes.data.loan_amount) : null,
    loanPurpose: loanRes?.data?.purpose ?? null,
  });
}
