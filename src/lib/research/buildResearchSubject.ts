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

// SPEC-RESEARCH-GATE-PRIVATE-BORROWER-AND-EVIDENCE-PACK-1
// Placeholder/deal-review labels that must NOT be web-searched as a legal entity.
// Centralizes (and extends with "deal review") the pattern from recovery/status.
const PLACEHOLDER_NAME_PATTERNS =
  /^(chatgpt|fix|test|deal\s*\d|new deal|untitled|draft)|\bdeal review\b/i;

/** True when a name is missing, too short, or a placeholder/deal-review label. */
export function isPlaceholderEntityName(name: string | null | undefined): boolean {
  const t = (name ?? "").trim();
  if (t.length < 2) return true;
  return PLACEHOLDER_NAME_PATTERNS.test(t);
}

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
    // SPEC-RESEARCH-GATE-PRIVATE-BORROWER-AND-EVIDENCE-PACK-1: deal-level entity
    // identity, used when no borrowers row is attached.
    legal_name?: string | null;
    dba?: string | null;
    website?: string | null;
    hq_city?: string | null;
    hq_state?: string | null;
    banker_identity_summary?: string | null;
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

// ─── Entity profile (private-company aware) ──────────────────────────────────

export type EntityCertificationLevel = "public" | "banker_certified" | "unidentified";

export type ResearchEntityProfile = AssembledResearchSubject & {
  display_name: string | null;
  legal_name: string | null;
  dba: string | null;
  website: string | null;
  /** Null when the only name is a placeholder deal label — do NOT web-search it. */
  company_search_name: string | null;
  hq_city: string | null;
  hq_state: string | null;
  banker_identity_summary: string | null;
  customer_anchors: string | null;
  name_is_placeholder: boolean;
  has_public_anchor: boolean;
  has_banker_certified_anchor: boolean;
  has_industry_context: boolean;
  has_management_context: boolean;
  private_company_mode_eligible: boolean;
  certification_level: EntityCertificationLevel;
};

/**
 * SPEC-RESEARCH-GATE-PRIVATE-BORROWER-AND-EVIDENCE-PACK-1
 *
 * Pure: builds on assembleResearchSubject with entity identity + deterministic
 * flags, and folds the identity context into the subject so the BIE prompts can
 * disambiguate (legal name / DBA / website first) and run a private-company path
 * for banker-certified borrowers with limited public footprint.
 */
export function assembleResearchEntityProfile(raw: ResearchSubjectRaw): ResearchEntityProfile {
  const base = assembleResearchSubject(raw);
  const story = raw.story ?? null;

  const legal_name = firstNonEmpty(raw.borrower?.legal_name, story?.legal_name);
  const dba = firstNonEmpty(story?.dba);
  const website = firstNonEmpty(story?.website);
  const display_name = firstNonEmpty(raw.dealBorrowerName, raw.dealDisplayName, raw.dealName);
  const banker_identity_summary = firstNonEmpty(story?.banker_identity_summary);
  const customer_anchors = firstNonEmpty(story?.customers);
  const hq_city = firstNonEmpty(raw.borrower?.city, story?.hq_city);
  const hq_state = firstNonEmpty(raw.borrower?.state, story?.hq_state, raw.dealState);

  // company_search_name: a real legal/DBA name, or a non-placeholder display name.
  // Null => only a placeholder deal label is available → entity-lock must not search it.
  const nonPlaceholderDisplay =
    display_name && !isPlaceholderEntityName(display_name) ? display_name : null;
  const company_search_name = firstNonEmpty(legal_name, dba, nonPlaceholderDisplay);
  const name_is_placeholder = company_search_name === null;

  const businessDesc = base.subject.business_description ?? null;
  const has_management_context = (base.subject.principals?.length ?? 0) > 0;
  const has_industry_context = !!(
    base.subject.naics_description ||
    (base.subject.naics_code && base.subject.naics_code !== PLACEHOLDER_NAICS)
  );
  const has_public_anchor = !!(website || dba || legal_name);
  const has_banker_certified_anchor = !!(
    (businessDesc && has_management_context) ||
    (banker_identity_summary && banker_identity_summary.length > 10) ||
    (base.subject.banker_summary && businessDesc)
  );
  const private_company_mode_eligible = base.represented && has_banker_certified_anchor;

  let certification_level: EntityCertificationLevel;
  if (!base.represented) certification_level = "unidentified";
  else if (has_public_anchor) certification_level = "public";
  else if (has_banker_certified_anchor) certification_level = "banker_certified";
  else certification_level = "unidentified";

  // Fold identity into the subject the BIE consumes. Prefer the legal name as the
  // company_name when present; otherwise keep the base resolution (still gates the
  // subject lock, while company_search_name governs whether the web is searched).
  const subject: MissionSubject = {
    ...base.subject,
    company_name: legal_name ?? base.subject.company_name,
    legal_name,
    dba: dba ?? base.subject.dba,
    website: website ?? base.subject.website,
    customer_anchors,
    company_search_name,
    private_company_mode: private_company_mode_eligible,
    has_banker_certified_anchor,
    city: hq_city ?? base.subject.city,
    state: hq_state ?? base.subject.state,
    banker_summary: firstNonEmpty(banker_identity_summary, base.subject.banker_summary),
  };

  return {
    subject,
    represented: base.represented,
    naics_provisional: base.naics_provisional,
    display_name,
    legal_name,
    dba,
    website,
    company_search_name,
    hq_city,
    hq_state,
    banker_identity_summary,
    customer_anchors,
    name_is_placeholder,
    has_public_anchor,
    has_banker_certified_anchor,
    has_industry_context,
    has_management_context,
    private_company_mode_eligible,
    certification_level,
  };
}

// ─── Async loaders ─────────────────────────────────────────────────────────--

type MinimalSb = { from: (table: string) => any };

/**
 * Load every source the research builders need into a ResearchSubjectRaw.
 * Story / management reads are filtered by deal_id ONLY (no bank_id), matching
 * hasBorrowerRepresentation exactly so `represented` cannot diverge from the
 * lifecycle/underwrite borrower-representation contract.
 */
async function loadResearchRaw(sb: MinimalSb, dealId: string): Promise<ResearchSubjectRaw> {
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
        "business_description, products_services, revenue_model, banker_notes, competitive_position, customers, industry_classification, naics_code, naics_description, legal_name, dba, website, hq_city, hq_state, banker_identity_summary",
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

  return {
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
  };
}

/** Subject-only loader (back-compat: run.ts subject-lock path). */
export async function buildResearchSubject(
  sb: MinimalSb,
  dealId: string,
): Promise<AssembledResearchSubject> {
  return assembleResearchSubject(await loadResearchRaw(sb, dealId));
}

/** Full entity profile loader (private-company aware) — used by run/flight-deck/recovery. */
export async function buildResearchEntityProfile(
  sb: MinimalSb,
  dealId: string,
): Promise<ResearchEntityProfile> {
  return assembleResearchEntityProfile(await loadResearchRaw(sb, dealId));
}
