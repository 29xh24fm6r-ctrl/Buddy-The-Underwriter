import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { extractBorrowerFromDocs } from "./extractBorrowerFromDocs";

export type ConfidenceLevel = "high" | "review" | "low";

export type FieldAutofillStatus = {
  field: string;
  confidence: number;
  level: ConfidenceLevel;
  applied: boolean;
};

export type AutofillResult = {
  ok: boolean;
  borrowerPatch: Record<string, unknown>;
  ownersUpserted: number;
  fieldsAutofilled: string[];
  fieldStatuses: FieldAutofillStatus[];
  extractedConfidence: Record<string, number>;
  warnings: string[];
};

// Confidence thresholds
const CONFIDENCE_AUTO_APPLY = 0.85; // >= 0.85 → apply automatically
const CONFIDENCE_REVIEW = 0.60;     // 0.60–0.84 → apply but mark needs_review
                                     // < 0.60 → do not apply

/**
 * Extract borrower data from uploaded documents (tax returns, OCR)
 * and apply it to the borrower record + create owner entries.
 *
 * This is the canonical autofill function called by /borrower/ensure.
 */
export async function autofillBorrowerFromDocs(args: {
  dealId: string;
  bankId: string;
  borrowerId: string;
  includeOwners: boolean;
}): Promise<AutofillResult> {
  const sb = supabaseAdmin();
  const warnings: string[] = [];
  const fieldsAutofilled: string[] = [];
  const borrowerPatch: Record<string, unknown> = {};

  // 1) Run extraction from OCR text
  let extraction: Awaited<ReturnType<typeof extractBorrowerFromDocs>> = null;
  try {
    extraction = await extractBorrowerFromDocs({
      dealId: args.dealId,
      bankId: args.bankId,
    });
  } catch (e: any) {
    warnings.push(`extraction_error: ${String(e?.message ?? e).slice(0, 200)}`);
  }

  if (!extraction) {
    warnings.push("No borrower data could be extracted from uploaded documents.");
    return { ok: false, borrowerPatch, ownersUpserted: 0, fieldsAutofilled, fieldStatuses: [], extractedConfidence: {}, warnings };
  }

  // 2) Build patch from extraction using confidence-gated application
  const provenance: Record<string, string> = {};
  const fc = extraction.fieldConfidence;
  const fieldStatuses: FieldAutofillStatus[] = [];

  function classifyConfidence(conf: number): ConfidenceLevel {
    if (conf >= CONFIDENCE_AUTO_APPLY) return "high";
    if (conf >= CONFIDENCE_REVIEW) return "review";
    return "low";
  }

  function tryApply(field: string, value: unknown, conf: number, sourceDocId: string | null) {
    const level = classifyConfidence(conf);
    const applied = conf >= CONFIDENCE_REVIEW; // Apply if >= 0.60
    fieldStatuses.push({ field, confidence: conf, level, applied });

    if (applied && value !== null && value !== undefined) {
      borrowerPatch[field] = value;
      fieldsAutofilled.push(field);
      if (sourceDocId) provenance[field] = sourceDocId;
      if (level === "review") {
        warnings.push(`${field}: confidence ${(conf * 100).toFixed(0)}% — needs review`);
      }
    } else if (!applied && value !== null) {
      warnings.push(`${field}: skipped (confidence ${(conf * 100).toFixed(0)}% below threshold)`);
    }
  }

  if (extraction.legalName) tryApply("legal_name", extraction.legalName, fc.legal_name, extraction.sourceDocId);
  if (extraction.entityType) tryApply("entity_type", extraction.entityType, fc.entity_type, extraction.sourceDocId);
  if (extraction.einMasked) tryApply("ein", extraction.einMasked, fc.ein, extraction.sourceDocId);
  if (extraction.naicsCode) tryApply("naics_code", extraction.naicsCode, fc.naics, extraction.sourceDocId);
  if (extraction.naicsDescription && fc.naics >= CONFIDENCE_REVIEW) {
    borrowerPatch.naics_description = extraction.naicsDescription;
  }
  if (extraction.stateOfFormation) tryApply("state_of_formation", extraction.stateOfFormation, fc.state_of_formation, extraction.sourceDocId);

  if (extraction.address) {
    const addr = extraction.address;
    const addrConf = fc.address;
    if (typeof addr === "object" && addr !== null) {
      if ((addr as any).line1) tryApply("address_line1", (addr as any).line1, addrConf, extraction.sourceDocId);
      if ((addr as any).city) tryApply("city", (addr as any).city, addrConf, extraction.sourceDocId);
      if ((addr as any).state) tryApply("state", (addr as any).state, addrConf, extraction.sourceDocId);
      if ((addr as any).zip) tryApply("zip", (addr as any).zip, addrConf, extraction.sourceDocId);
    } else if (typeof addr === "string" && addr.trim()) {
      tryApply("address_line1", addr, addrConf, extraction.sourceDocId);
    }
  }

  // Build extracted_confidence map for persistence
  const extractedConfidence: Record<string, number> = {
    legal_name: fc.legal_name,
    entity_type: fc.entity_type,
    ein: fc.ein,
    naics: fc.naics,
    address: fc.address,
    state_of_formation: fc.state_of_formation,
    ...Object.fromEntries(
      Object.entries(fc.owners).map(([k, v]) => [`owner.${k}`, v])
    ),
  };

  // 3) Apply patch to borrower record
  if (Object.keys(borrowerPatch).length > 0) {
    borrowerPatch.profile_provenance = provenance;
    borrowerPatch.extracted_confidence = extractedConfidence;
    borrowerPatch.updated_at = new Date().toISOString();

    const { error } = await sb
      .from("borrowers")
      .update(borrowerPatch as any)
      .eq("id", args.borrowerId);

    if (error) {
      // Try without columns that may not exist yet
      const fallbackPatch: Record<string, unknown> = {};
      const safeCols = ["legal_name", "entity_type", "ein", "updated_at"];
      for (const k of safeCols) {
        if (k in borrowerPatch) fallbackPatch[k] = borrowerPatch[k];
      }
      if (Object.keys(fallbackPatch).length > 0) {
        const fb = await sb.from("borrowers").update(fallbackPatch as any).eq("id", args.borrowerId);
        if (fb.error) {
          warnings.push(`borrower_update_failed: ${fb.error.message}`);
        }
      } else {
        warnings.push(`borrower_update_failed: ${error.message}`);
      }
    }
  } else {
    warnings.push("No fields could be extracted from documents.");
  }

  // 4) Upsert owners (>= 20% threshold) if requested
  let ownersUpserted = 0;
  if (args.includeOwners && extraction.owners && extraction.owners.length > 0) {
    const significantOwners = extraction.owners.filter((o) => {
      const pct = Number(o.ownership_pct ?? 0);
      return pct >= 20 || extraction.owners!.length <= 3;
    });

    for (const owner of significantOwners) {
      const name = String(owner.name ?? "").trim();
      if (!name) continue;

      const ownerKey = name.toLowerCase().replace(/\s+/g, "_");
      const ownerConf = fc.owners[ownerKey] ?? 0;
      if (ownerConf < CONFIDENCE_REVIEW) {
        warnings.push(`owner_skipped: ${name} (confidence ${(ownerConf * 100).toFixed(0)}% below threshold)`);
        continue;
      }

      const pct = Number(owner.ownership_pct ?? 0) || null;
      const ownerRow = {
        borrower_id: args.borrowerId,
        full_name: name,
        title: owner.title ?? null,
        ownership_percent: pct,
        ownership_source: "doc_extracted" as const,
        requires_pfs: (pct ?? 0) >= 20,
        source_doc_id: extraction.sourceDocId ?? null,
        extracted_at: new Date().toISOString(),
      };

      const { error } = await sb
        .from("borrower_owners")
        .upsert(ownerRow as any, { onConflict: "borrower_id,full_name" })
        .select("id")
        .maybeSingle();

      if (error) {
        const insertResult = await sb.from("borrower_owners").insert(ownerRow as any);
        if (!insertResult.error) {
          ownersUpserted++;
        } else {
          warnings.push(`owner_insert_failed: ${name} - ${insertResult.error.message}`);
        }
      } else {
        ownersUpserted++;
      }
    }
  } else if (args.includeOwners) {
    warnings.push("No owners found in uploaded documents.");
  }

  if (!extraction.naicsCode) {
    warnings.push("NAICS code not found in uploaded returns.");
  }

  return {
    ok: fieldsAutofilled.length > 0 || ownersUpserted > 0,
    borrowerPatch,
    ownersUpserted,
    fieldsAutofilled,
    fieldStatuses,
    extractedConfidence,
    warnings,
  };
}
