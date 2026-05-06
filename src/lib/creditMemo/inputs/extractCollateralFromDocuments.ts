// Server-only extractor that materializes collateral candidates from
// documents already classified by the intake pipeline.
//
// We intentionally do NOT call an LLM here — the canonical extraction
// pipeline (Gemini structured assist + deterministic extractors) runs
// upstream. This module is a deterministic projector: it reads facts the
// pipeline already produced and writes them as collateral rows when the
// document category matches a collateral source.
//
// Sources (see spec):
//   appraisal | UCC | purchase agreement | equipment schedule
//   real-estate-tax record | insurance | title / lien
// All write requires_review=true when confidence < 0.85.

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { upsertCollateralItem } from "./upsertCollateralItem";

const COLLATERAL_DOC_CATEGORIES = new Set<string>([
  "APPRAISAL",
  "UCC",
  "PURCHASE_AGREEMENT",
  "EQUIPMENT_SCHEDULE",
  "REAL_ESTATE_TAX_RECORD",
  "INSURANCE",
  "TITLE_LIEN",
]);

export type ExtractCollateralResult =
  | {
      ok: true;
      candidatesEvaluated: number;
      itemsUpserted: number;
      itemsFlaggedForReview: number;
    }
  | { ok: false; reason: "tenant_mismatch" | "load_failed"; error?: string };

export async function extractCollateralFromDocuments(args: {
  dealId: string;
}): Promise<ExtractCollateralResult> {
  const access = await ensureDealBankAccess(args.dealId);
  if (!access.ok) {
    return { ok: false, reason: "tenant_mismatch", error: access.error };
  }
  const { bankId } = access;
  const sb = supabaseAdmin();

  // Load extracted-fact rows that point to collateral-class documents.
  const { data: facts, error } = await (sb as any)
    .from("deal_financial_facts")
    .select(
      "fact_key, fact_value_num, fact_type, source_document_id, period_end, fact_meta, created_at, confidence_score",
    )
    .eq("deal_id", args.dealId)
    .eq("bank_id", bankId)
    .eq("is_superseded", false)
    .in("fact_key", [
      "appraised_value",
      "market_value",
      "collateral_value",
      "advance_rate",
      "lien_position",
    ]);

  if (error) {
    return { ok: false, reason: "load_failed", error: error.message };
  }

  // Group facts by source_document_id — one collateral item per source doc.
  const grouped = new Map<string, any[]>();
  for (const f of (facts ?? []) as any[]) {
    if (!f.source_document_id) continue;
    const list = grouped.get(f.source_document_id) ?? [];
    list.push(f);
    grouped.set(f.source_document_id, list);
  }

  if (grouped.size === 0) {
    return {
      ok: true,
      candidatesEvaluated: 0,
      itemsUpserted: 0,
      itemsFlaggedForReview: 0,
    };
  }

  // Load doc metadata to filter to collateral-class categories.
  const docIds = [...grouped.keys()];
  const { data: docs } = await (sb as any)
    .from("deal_documents")
    .select(
      "id, canonical_type, document_type, original_name, assigned_owner_id",
    )
    .in("id", docIds);

  const docMap = new Map<string, any>();
  for (const d of (docs ?? []) as any[]) docMap.set(d.id, d);

  let upserted = 0;
  let flagged = 0;

  for (const [docId, factRows] of grouped) {
    const doc = docMap.get(docId);
    if (!doc) continue;
    const canonical = String(doc.canonical_type ?? doc.document_type ?? "")
      .toUpperCase();
    if (!isCollateralCategory(canonical)) continue;

    const collateralType = canonicalToCollateralType(canonical);
    const description = String(doc.original_name ?? canonical);

    let market: number | null = null;
    let appraised: number | null = null;
    let advanceRate: number | null = null;
    let lienPosition: string | null = null;
    let valuationDate: string | null = null;
    let confidence: number | null = null;

    for (const f of factRows) {
      const v = typeof f.fact_value_num === "number" ? f.fact_value_num : null;
      switch (f.fact_key) {
        case "market_value":
          market = v ?? market;
          break;
        case "appraised_value":
          appraised = v ?? appraised;
          break;
        case "collateral_value":
          if (canonical === "APPRAISAL" && appraised === null) appraised = v;
          else if (market === null) market = v;
          break;
        case "advance_rate":
          advanceRate = v ?? advanceRate;
          break;
        case "lien_position":
          if (typeof f.fact_meta === "object" && f.fact_meta) {
            const meta = f.fact_meta as Record<string, unknown>;
            const raw = meta.lien_position ?? meta.position;
            if (typeof raw === "string") lienPosition = raw;
            else if (typeof raw === "number") lienPosition = String(raw);
          } else if (v !== null) {
            lienPosition = String(v);
          }
          break;
      }
      if (f.period_end && !valuationDate) valuationDate = f.period_end;
      const conf =
        typeof f.confidence_score === "number" ? f.confidence_score : null;
      if (conf !== null) {
        confidence = confidence === null ? conf : Math.min(confidence, conf);
      }
    }

    const requiresReview = confidence !== null && confidence < 0.85;
    if (requiresReview) flagged += 1;

    const result = await upsertCollateralItem({
      dealId: args.dealId,
      patch: {
        collateral_type: collateralType,
        description,
        market_value: market,
        appraised_value: appraised,
        advance_rate: advanceRate,
        lien_position: lienPosition,
        valuation_date: valuationDate,
        valuation_source: canonical,
        source_document_id: docId,
        confidence,
      },
      requiresReviewOverride: requiresReview,
    });
    if (result.ok) upserted += 1;
  }

  return {
    ok: true,
    candidatesEvaluated: grouped.size,
    itemsUpserted: upserted,
    itemsFlaggedForReview: flagged,
  };
}

function isCollateralCategory(canonical: string): boolean {
  if (COLLATERAL_DOC_CATEGORIES.has(canonical)) return true;
  if (canonical.includes("APPRAISAL")) return true;
  if (canonical.includes("UCC")) return true;
  if (canonical.includes("PURCHASE")) return true;
  if (canonical.includes("EQUIPMENT")) return true;
  if (canonical.includes("INSURANCE")) return true;
  if (canonical.includes("TITLE")) return true;
  return false;
}

function canonicalToCollateralType(canonical: string): string {
  if (canonical.includes("APPRAISAL")) return "real_estate";
  if (canonical.includes("EQUIPMENT")) return "equipment";
  if (canonical.includes("UCC")) return "ucc_lien";
  if (canonical.includes("INSURANCE")) return "insurance_backed";
  if (canonical.includes("PURCHASE")) return "purchase_target";
  if (canonical.includes("TITLE")) return "real_estate";
  return "general";
}
