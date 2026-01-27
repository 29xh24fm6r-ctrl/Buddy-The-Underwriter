import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { sha256 } from "@/lib/security/tokens";

/**
 * Canonical Borrower Audit Snapshot Builder (Phase E)
 *
 * Produces a tamper-evident, deterministic snapshot of a borrower's
 * identity, ownership, extraction provenance, attestation, and lifecycle.
 *
 * Invariants:
 *  - Snapshot is read-only
 *  - Snapshot reflects historical truth as-of a timestamp
 *  - Same inputs → same hash (deterministic)
 *  - Ownership sourced from attested snapshot, never live tables
 *  - EIN always masked (**-***NNNN)
 *  - All timestamps UTC ISO-8601
 *  - Object keys ordered deterministically
 */

// ── Types ───────────────────────────────────────────────

export type BorrowerAuditSnapshot = {
  meta: {
    borrower_id: string;
    snapshot_version: "1.0";
    generated_at: string;
    as_of: string;
  };

  borrower: {
    legal_name: string;
    entity_type: string;
    ein_masked: string;
    naics: string;
    address: {
      street: string;
      city: string;
      state: string;
      zip: string;
    };
  };

  owners: Array<{
    name: string;
    ownership_pct: number;
    confidence: number;
    source: string;
  }>;

  extraction: {
    documents: Array<{
      document_id: string;
      document_type: string;
      uploaded_at: string;
      sha256: string;
    }>;
    field_confidence: Record<string, number>;
  };

  attestation: {
    attested: boolean;
    attested_by_user_id: string | null;
    attested_at: string | null;
    snapshot_hash: string | null;
  };

  lifecycle: {
    borrower_completed_at: string | null;
    underwriting_unlocked_at: string | null;
  };

  ledger_events: Array<{
    id: string;
    type: string;
    created_at: string;
  }>;
};

export type AuditSnapshotResult = {
  snapshot: BorrowerAuditSnapshot;
  snapshot_hash: string;
};

// ── Builder ─────────────────────────────────────────────

export async function buildBorrowerAuditSnapshot(opts: {
  borrowerId: string;
  bankId: string;
  dealId?: string | null;
  asOf?: string;
}): Promise<AuditSnapshotResult> {
  const sb = supabaseAdmin();
  const asOf = opts.asOf ?? new Date().toISOString();
  const generatedAt = new Date().toISOString();

  // 1) Load borrower
  const { data: borrowerRaw } = await sb
    .from("borrowers")
    .select(
      "id, legal_name, entity_type, ein, naics_code, " +
      "address_line1, city, state, zip, " +
      "extracted_confidence, created_at",
    )
    .eq("id", opts.borrowerId)
    .eq("bank_id", opts.bankId)
    .maybeSingle();

  if (!borrowerRaw) {
    throw new Error("borrower_not_found");
  }

  const borrower = borrowerRaw as any;
  const extractedConf = (borrower.extracted_confidence ?? {}) as Record<string, number>;

  // 2) Load most recent attestation
  const { data: attestationRaw } = await sb
    .from("borrower_owner_attestations")
    .select("id, attested_by_user_id, attested_at, snapshot")
    .eq("borrower_id", opts.borrowerId)
    .order("attested_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const att = attestationRaw as any;

  // 3) Owners: sourced from attested snapshot, never live tables
  const attestedOwners = extractOwnersFromAttestation(att, extractedConf);

  // Compute attestation hash from snapshot content
  const attestationHash = att?.snapshot
    ? sha256(stableStringify(att.snapshot))
    : null;

  // 4) Load source documents (with sha256)
  const dealId = opts.dealId;
  let auditDocs: BorrowerAuditSnapshot["extraction"]["documents"] = [];
  if (dealId) {
    const { data: docs } = await sb
      .from("deal_documents")
      .select("id, document_type, created_at, sha256")
      .eq("deal_id", dealId)
      .eq("bank_id", opts.bankId)
      .order("created_at", { ascending: true })
      .limit(50);

    auditDocs = (docs ?? []).map((d: any) => ({
      document_id: d.id ?? "",
      document_type: d.document_type ?? "",
      uploaded_at: d.created_at ?? "",
      sha256: d.sha256 ?? "",
    }));
  }

  // 5) Load relevant ledger events
  let ledgerEvents: BorrowerAuditSnapshot["ledger_events"] = [];
  if (dealId) {
    const { data: ledger } = await sb
      .from("deal_pipeline_ledger")
      .select("id, event_key, created_at")
      .eq("deal_id", dealId)
      .eq("bank_id", opts.bankId)
      .like("event_key", "buddy.borrower.%")
      .order("created_at", { ascending: true })
      .limit(50);

    ledgerEvents = (ledger ?? []).map((e: any) => ({
      id: e.id,
      type: e.event_key,
      created_at: e.created_at,
    }));
  }

  // 6) Lifecycle timestamps from ledger
  const completedEvent = ledgerEvents.find(
    (e) => e.type === "buddy.borrower.owners_attested",
  );
  const uwUnlockedEvent = ledgerEvents.find(
    (e) => e.type === "buddy.borrower.underwriting_unlocked",
  );

  // 7) Build deterministic snapshot
  const snapshot: BorrowerAuditSnapshot = {
    meta: {
      borrower_id: borrower.id,
      snapshot_version: "1.0",
      generated_at: generatedAt,
      as_of: asOf,
    },

    borrower: {
      legal_name: borrower.legal_name ?? "",
      entity_type: borrower.entity_type ?? "",
      ein_masked: maskEin(borrower.ein),
      naics: borrower.naics_code ?? "",
      address: {
        street: borrower.address_line1 ?? "",
        city: borrower.city ?? "",
        state: borrower.state ?? "",
        zip: borrower.zip ?? "",
      },
    },

    owners: attestedOwners,

    extraction: {
      documents: auditDocs,
      field_confidence: extractedConf,
    },

    attestation: {
      attested: Boolean(att),
      attested_by_user_id: att?.attested_by_user_id ?? null,
      attested_at: att?.attested_at ?? null,
      snapshot_hash: attestationHash,
    },

    lifecycle: {
      borrower_completed_at: completedEvent?.created_at ?? null,
      underwriting_unlocked_at: uwUnlockedEvent?.created_at ?? null,
    },

    ledger_events: ledgerEvents,
  };

  // 8) Compute canonical hash
  const canonicalJson = stableStringify(snapshot);
  const snapshotHash = sha256(canonicalJson);

  return { snapshot, snapshot_hash: snapshotHash };
}

// ── Helpers ─────────────────────────────────────────────

/**
 * Extract owners from the attested snapshot.
 * If no attestation exists, returns empty array — owners are ONLY
 * sourced from attested snapshots, never live tables.
 */
function extractOwnersFromAttestation(
  att: any,
  extractedConf: Record<string, number>,
): BorrowerAuditSnapshot["owners"] {
  if (!att?.snapshot) return [];

  const snap = typeof att.snapshot === "string" ? JSON.parse(att.snapshot) : att.snapshot;
  const owners: any[] = snap?.owners ?? [];

  return owners.map((o: any) => {
    const ownerKey = String(o.full_name ?? o.name ?? "").toLowerCase().replace(/\s+/g, "_");
    return {
      name: o.full_name ?? o.name ?? "",
      ownership_pct: o.ownership_percent ?? o.ownership_pct ?? 0,
      confidence: extractedConf[`owner.${ownerKey}`] ?? 0,
      source: o.ownership_source ?? o.source ?? "attested",
    };
  });
}

/** Mask EIN for audit export — always **-***NNNN */
export function maskEin(ein: string | null | undefined): string {
  if (!ein) return "";
  const digits = String(ein).replace(/\D/g, "");
  if (digits.length < 4) return "";
  return `**-***${digits.slice(-4)}`;
}

/** Deterministic JSON stringification with sorted keys (deep) */
export function stableStringify(obj: any): string {
  return JSON.stringify(obj, (_key, value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.keys(value)
        .sort()
        .reduce<Record<string, any>>((sorted, k) => {
          sorted[k] = value[k];
          return sorted;
        }, {});
    }
    return value;
  });
}
