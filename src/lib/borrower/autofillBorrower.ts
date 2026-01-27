import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { extractBorrowerFromDocs } from "./extractBorrowerFromDocs";

export type AutofillResult = {
  ok: boolean;
  borrowerPatch: Record<string, unknown>;
  ownersUpserted: number;
  fieldsAutofilled: string[];
  warnings: string[];
};

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
    return { ok: false, borrowerPatch, ownersUpserted: 0, fieldsAutofilled, warnings };
  }

  // 2) Build patch from extraction
  const provenance: Record<string, string> = {};

  if (extraction.legalName) {
    borrowerPatch.legal_name = extraction.legalName;
    fieldsAutofilled.push("legal_name");
    if (extraction.sourceDocId) provenance.legal_name = extraction.sourceDocId;
  }

  if (extraction.entityType) {
    borrowerPatch.entity_type = extraction.entityType;
    fieldsAutofilled.push("entity_type");
    if (extraction.sourceDocId) provenance.entity_type = extraction.sourceDocId;
  }

  if (extraction.einMasked) {
    borrowerPatch.ein = extraction.einMasked;
    fieldsAutofilled.push("ein");
    if (extraction.sourceDocId) provenance.ein = extraction.sourceDocId;
  }

  if (extraction.naicsCode) {
    borrowerPatch.naics_code = extraction.naicsCode;
    fieldsAutofilled.push("naics_code");
    if (extraction.sourceDocId) provenance.naics_code = extraction.sourceDocId;
  }

  if (extraction.naicsDescription) {
    borrowerPatch.naics_description = extraction.naicsDescription;
  }

  if (extraction.stateOfFormation) {
    borrowerPatch.state_of_formation = extraction.stateOfFormation;
    fieldsAutofilled.push("state_of_formation");
    if (extraction.sourceDocId) provenance.state_of_formation = extraction.sourceDocId;
  }

  if (extraction.address) {
    const addr = extraction.address;
    if (typeof addr === "object" && addr !== null) {
      if ((addr as any).line1) { borrowerPatch.address_line1 = (addr as any).line1; fieldsAutofilled.push("address_line1"); }
      if ((addr as any).city) { borrowerPatch.city = (addr as any).city; fieldsAutofilled.push("city"); }
      if ((addr as any).state) { borrowerPatch.state = (addr as any).state; fieldsAutofilled.push("state"); }
      if ((addr as any).zip) { borrowerPatch.zip = (addr as any).zip; fieldsAutofilled.push("zip"); }
    } else if (typeof addr === "string" && addr.trim()) {
      // Legacy: address was a single string. Store in address_line1 for now.
      borrowerPatch.address_line1 = addr;
      fieldsAutofilled.push("address_line1");
    }
  }

  // 3) Apply patch to borrower record
  if (Object.keys(borrowerPatch).length > 0) {
    borrowerPatch.profile_provenance = provenance;
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
    const significantOwners = extraction.owners.filter((o: any) => {
      const pct = Number(o.ownership_pct ?? o.ownershipPercent ?? 0);
      return pct >= 20 || extraction.owners!.length <= 3; // If ≤3 owners listed, include all
    });

    for (const owner of significantOwners) {
      const name = String(owner.name ?? "").trim();
      if (!name) continue;

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
        // Fallback: try plain insert if upsert conflict key doesn't exist
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
    warnings,
  };
}
