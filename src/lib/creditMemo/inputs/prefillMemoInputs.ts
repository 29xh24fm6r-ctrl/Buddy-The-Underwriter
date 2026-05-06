// Server-only assembler for memo-input prefill suggestions.
//
// Reads non-banker-certified signals and converts them into SuggestedValue
// entries. The banker reviews and accepts/edits/dismisses before any value
// becomes a certified borrower-story / management / collateral row.
//
// Sources:
//   • deals row (name, industry, description, entity_type, amount)
//   • borrowers / borrower record
//   • document extracts (business plan, resume, PFS, appraisal, UCC)
//   • research narrative (industry overview, competitive landscape)
//   • collateral facts (appraised_value, market_value)
//
// This is deterministic — no LLM call. The advisory layer (Gemini Flash)
// already wrote structured facts; we project them.

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { loadResearchForMemo } from "@/lib/creditMemo/canonical/loadResearchForMemo";
import type {
  MemoInputPrefill,
  SuggestedCollateralItem,
  SuggestedManagementProfile,
  SuggestedValue,
} from "./prefillTypes";

export type PrefillResult =
  | { ok: true; prefill: MemoInputPrefill }
  | { ok: false; reason: "tenant_mismatch" | "load_failed"; error?: string };

export async function prefillMemoInputs(args: {
  dealId: string;
}): Promise<PrefillResult> {
  const access = await ensureDealBankAccess(args.dealId);
  if (!access.ok) {
    return { ok: false, reason: "tenant_mismatch", error: access.error };
  }
  const { bankId } = access;
  const sb = supabaseAdmin();

  const [dealRow, ownersRows, collateralFacts, collateralDocs, research] =
    await Promise.all([
      loadDeal(sb, args.dealId, bankId),
      loadOwners(sb, args.dealId),
      loadCollateralFacts(sb, args.dealId, bankId),
      loadCollateralDocs(sb, args.dealId),
      loadResearchForMemo({ dealId: args.dealId, bankId }).catch(() => null),
    ]);

  const borrower_story = buildBorrowerStorySuggestions({
    deal: dealRow,
    research,
  });

  const management_profiles = buildManagementSuggestions({
    owners: ownersRows,
  });

  const collateral_items = buildCollateralSuggestions({
    facts: collateralFacts,
    docs: collateralDocs,
  });

  return {
    ok: true,
    prefill: { borrower_story, management_profiles, collateral_items },
  };
}

// ─── Borrower story ──────────────────────────────────────────────────────────

function buildBorrowerStorySuggestions(args: {
  deal: any | null;
  research: Awaited<ReturnType<typeof loadResearchForMemo>>;
}): MemoInputPrefill["borrower_story"] {
  const out: MemoInputPrefill["borrower_story"] = {};
  const { deal, research } = args;

  // Business description: prefer research industry overview, fall back to
  // deal description / industry combination.
  if (research?.industry_overview && research.industry_overview !== "Pending") {
    out.business_description = {
      value: research.industry_overview,
      source: "research",
      confidence: 0.7,
      reason: "Research mission's industry overview narrative",
    };
  } else if (deal?.description && typeof deal.description === "string") {
    out.business_description = {
      value: String(deal.description).trim(),
      source: "deal",
      confidence: 0.6,
      reason: "Description captured at deal intake",
    };
  } else if (deal?.industry || deal?.naics_code) {
    const industry = String(deal.industry ?? "").trim();
    out.business_description = {
      value: industry
        ? `Operates in ${industry}.`
        : `NAICS ${deal.naics_code}`,
      source: "deal",
      confidence: 0.4,
      reason: "Inferred from intake industry / NAICS",
    };
  }

  if (research?.market_dynamics && research.market_dynamics !== "Pending") {
    out.products_services = {
      value: research.market_dynamics,
      source: "research",
      confidence: 0.6,
      reason: "Research market dynamics narrative",
    };
  }

  if (research?.competitive_positioning && research.competitive_positioning !== "Pending") {
    out.competitive_position = {
      value: research.competitive_positioning,
      source: "research",
      confidence: 0.7,
      reason: "Research competitive landscape",
    };
  }

  if (research?.litigation_and_risk) {
    out.key_risks = {
      value: research.litigation_and_risk,
      source: "research",
      confidence: 0.6,
      reason: "Research litigation & risk section",
    };
  }

  return out;
}

// ─── Management profiles ─────────────────────────────────────────────────────

function buildManagementSuggestions(args: {
  owners: any[];
}): SuggestedManagementProfile[] {
  const profiles: SuggestedManagementProfile[] = [];
  for (const o of args.owners) {
    const name = String(o.display_name ?? "").trim();
    if (!name) continue;
    const profile: SuggestedManagementProfile = {
      person_name: {
        value: name,
        source: "deal",
        confidence: 0.95,
        source_id: typeof o.id === "string" ? o.id : undefined,
        reason: "Captured at intake (ownership_entities)",
      },
    };
    if (typeof o.ownership_pct === "number") {
      profile.ownership_pct = {
        value: String(o.ownership_pct),
        source: "deal",
        confidence: 0.95,
        reason: "Ownership percentage from intake",
      };
    }
    if (typeof o.title === "string" && o.title.trim().length > 0) {
      profile.title = {
        value: o.title,
        source: "deal",
        confidence: 0.85,
        reason: "Title from intake",
      };
    }
    profiles.push(profile);
  }
  return profiles;
}

// ─── Collateral ──────────────────────────────────────────────────────────────

function buildCollateralSuggestions(args: {
  facts: any[];
  docs: any[];
}): SuggestedCollateralItem[] {
  const docMap = new Map<string, any>();
  for (const d of args.docs) docMap.set(d.id, d);

  // Group facts by source_document_id.
  const grouped = new Map<string, any[]>();
  for (const f of args.facts) {
    if (!f.source_document_id) continue;
    const list = grouped.get(f.source_document_id) ?? [];
    list.push(f);
    grouped.set(f.source_document_id, list);
  }

  const items: SuggestedCollateralItem[] = [];
  for (const [docId, facts] of grouped) {
    const doc = docMap.get(docId);
    if (!doc) continue;
    const canonical = String(doc.canonical_type ?? doc.document_type ?? "").toUpperCase();
    if (!isCollateralDoc(canonical)) continue;

    const collateralType = canonicalToType(canonical);
    let market: number | null = null;
    let appraised: number | null = null;
    let advanceRate: number | null = null;
    let confidence: number | null = null;

    for (const f of facts) {
      const v = typeof f.fact_value_num === "number" ? f.fact_value_num : null;
      if (f.fact_key === "market_value") market = v ?? market;
      if (f.fact_key === "appraised_value") appraised = v ?? appraised;
      if (f.fact_key === "advance_rate") advanceRate = v ?? advanceRate;
      if (f.fact_key === "collateral_value") {
        if (canonical === "APPRAISAL" && appraised === null) appraised = v;
        else if (market === null) market = v;
      }
      const conf = typeof f.confidence_score === "number" ? f.confidence_score : null;
      if (conf !== null) confidence = confidence === null ? conf : Math.min(confidence, conf);
    }

    const item: SuggestedCollateralItem = {
      collateral_type: {
        value: collateralType,
        source: "document",
        confidence: 0.9,
        source_id: docId,
        reason: `Inferred from document type ${canonical}`,
      },
      description: {
        value: String(doc.original_name ?? canonical),
        source: "document",
        confidence: 0.8,
        source_id: docId,
        reason: "Document filename",
      },
    };
    if (market !== null) {
      item.market_value = {
        value: String(market),
        source: "document",
        confidence: clamp(confidence ?? 0.8, 0.3, 0.99),
        source_id: docId,
        reason: "Extracted market value",
      };
    }
    if (appraised !== null) {
      item.appraised_value = {
        value: String(appraised),
        source: "document",
        confidence: clamp(confidence ?? 0.8, 0.3, 0.99),
        source_id: docId,
        reason: "Extracted appraised value",
      };
    }
    if (advanceRate !== null) {
      item.advance_rate = {
        value: String(advanceRate),
        source: "document",
        confidence: 0.7,
        source_id: docId,
        reason: "Extracted advance rate",
      };
    }
    item.valuation_source = {
      value: canonical,
      source: "document",
      confidence: 0.95,
      reason: "Document canonical type",
    };
    item.source_document_id = {
      value: docId,
      source: "document",
      confidence: 1,
      source_id: docId,
      reason: "Source document",
    };
    items.push(item);
  }
  return items;
}

// ─── Loaders ─────────────────────────────────────────────────────────────────

async function loadDeal(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
  bankId: string,
): Promise<any | null> {
  try {
    const { data } = await (sb as any)
      .from("deals")
      .select("*")
      .eq("id", dealId)
      .eq("bank_id", bankId)
      .maybeSingle();
    return data ?? null;
  } catch {
    return null;
  }
}

async function loadOwners(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
): Promise<any[]> {
  try {
    const { data } = await (sb as any)
      .from("ownership_entities")
      .select("id, display_name, ownership_pct, title")
      .eq("deal_id", dealId);
    return (data ?? []) as any[];
  } catch {
    return [];
  }
}

async function loadCollateralFacts(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
  bankId: string,
): Promise<any[]> {
  try {
    const { data } = await (sb as any)
      .from("deal_financial_facts")
      .select(
        "fact_key, fact_value_num, fact_type, source_document_id, period_end, confidence_score",
      )
      .eq("deal_id", dealId)
      .eq("bank_id", bankId)
      .eq("is_superseded", false)
      .in("fact_key", [
        "appraised_value",
        "market_value",
        "collateral_value",
        "advance_rate",
        "lien_position",
      ]);
    return (data ?? []) as any[];
  } catch {
    return [];
  }
}

async function loadCollateralDocs(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
): Promise<any[]> {
  try {
    const { data } = await (sb as any)
      .from("deal_documents")
      .select("id, canonical_type, document_type, original_name")
      .eq("deal_id", dealId);
    return (data ?? []) as any[];
  } catch {
    return [];
  }
}

function isCollateralDoc(canonical: string): boolean {
  return (
    canonical.includes("APPRAISAL") ||
    canonical.includes("UCC") ||
    canonical.includes("PURCHASE") ||
    canonical.includes("EQUIPMENT") ||
    canonical.includes("INSURANCE") ||
    canonical.includes("TITLE")
  );
}

function canonicalToType(canonical: string): string {
  if (canonical.includes("APPRAISAL")) return "real_estate";
  if (canonical.includes("EQUIPMENT")) return "equipment";
  if (canonical.includes("UCC")) return "ucc_lien";
  if (canonical.includes("INSURANCE")) return "insurance_backed";
  if (canonical.includes("PURCHASE")) return "purchase_target";
  if (canonical.includes("TITLE")) return "real_estate";
  return "general";
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
