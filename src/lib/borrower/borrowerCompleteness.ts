import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Borrower Completeness Evaluation
 *
 * Required for underwriting lifecycle gate:
 * - borrower exists + legal_name + entity_type + ein + naics_code
 * - address (at least address_line1 + state)
 * - >= 1 owner with >= 20% ownership
 * - total ownership >= 80%
 * - owner attestation on file
 */

export type BorrowerCompleteness = {
  complete: boolean;
  missing: string[];
  confidence_warnings: string[];
  stats: {
    fields_present: number;
    fields_required: number;
    owner_count: number;
    total_ownership_pct: number;
    has_attestation: boolean;
  };
};

const REQUIRED_FIELDS = [
  "legal_name",
  "entity_type",
  "ein",
  "naics_code",
] as const;

const ADDRESS_FIELDS = ["address_line1", "state"] as const;

const OWNERSHIP_MIN_PCT = 20;
const TOTAL_OWNERSHIP_THRESHOLD = 80;

export async function evaluateBorrowerCompleteness(args: {
  borrowerId: string;
  bankId: string;
}): Promise<BorrowerCompleteness> {
  const sb = supabaseAdmin();
  const missing: string[] = [];
  const confidence_warnings: string[] = [];

  // 1) Load borrower record
  const { data: borrower, error: bErr } = await sb
    .from("borrowers")
    .select(
      "id, legal_name, entity_type, ein, naics_code, address_line1, city, state, zip, state_of_formation, extracted_confidence",
    )
    .eq("id", args.borrowerId)
    .eq("bank_id", args.bankId)
    .maybeSingle();

  if (bErr || !borrower) {
    return {
      complete: false,
      missing: ["borrower_not_found"],
      confidence_warnings: [],
      stats: {
        fields_present: 0,
        fields_required: REQUIRED_FIELDS.length + ADDRESS_FIELDS.length,
        owner_count: 0,
        total_ownership_pct: 0,
        has_attestation: false,
      },
    };
  }

  // 2) Check required fields
  let fieldsPresent = 0;
  const totalRequired = REQUIRED_FIELDS.length + ADDRESS_FIELDS.length;

  for (const field of REQUIRED_FIELDS) {
    const val = (borrower as any)[field];
    if (val && String(val).trim()) {
      fieldsPresent++;
    } else {
      missing.push(field);
    }
  }

  for (const field of ADDRESS_FIELDS) {
    const val = (borrower as any)[field];
    if (val && String(val).trim()) {
      fieldsPresent++;
    } else {
      missing.push(field);
    }
  }

  // 3) Check extracted confidence for review warnings
  const conf = (borrower as any).extracted_confidence as Record<string, number> | null;
  if (conf) {
    for (const [field, value] of Object.entries(conf)) {
      if (field.startsWith("owner.")) continue;
      if (value >= 0.6 && value < 0.85) {
        confidence_warnings.push(
          `${field}: ${(value * 100).toFixed(0)}% confidence — needs review`,
        );
      }
    }
  }

  // 4) Check owners
  const { data: owners } = await sb
    .from("borrower_owners")
    .select("id, full_name, ownership_percent")
    .eq("borrower_id", args.borrowerId);

  const ownerList = owners ?? [];
  const significantOwners = ownerList.filter(
    (o: any) => Number(o.ownership_percent ?? 0) >= OWNERSHIP_MIN_PCT,
  );
  const totalOwnership = ownerList.reduce(
    (sum: number, o: any) => sum + Number(o.ownership_percent ?? 0),
    0,
  );

  if (significantOwners.length === 0) {
    missing.push("owner_gte_20pct");
  }
  if (totalOwnership < TOTAL_OWNERSHIP_THRESHOLD) {
    missing.push("total_ownership_gte_80pct");
  }

  // 5) Check attestation
  const { data: attestation } = await sb
    .from("borrower_owner_attestations")
    .select("id")
    .eq("borrower_id", args.borrowerId)
    .order("attested_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const hasAttestation = Boolean(attestation);
  if (!hasAttestation) {
    missing.push("owner_attestation");
  }

  return {
    complete: missing.length === 0,
    missing,
    confidence_warnings,
    stats: {
      fields_present: fieldsPresent,
      fields_required: totalRequired,
      owner_count: ownerList.length,
      total_ownership_pct: totalOwnership,
      has_attestation: hasAttestation,
    },
  };
}
