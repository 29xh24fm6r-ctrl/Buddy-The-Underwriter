import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { stableHash } from "@/lib/decision/hash";

/**
 * Borrower Audit Snapshot Builder
 *
 * Produces a tamper-evident, deterministic snapshot of a borrower's
 * identity, ownership, extraction provenance, attestation, and lifecycle.
 *
 * Every fact is traceable to a document, extraction, user attestation,
 * or ledger event. The snapshot is reproducible for a given borrower + timestamp.
 */

export type BorrowerAuditAddress = {
  line1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
};

export type BorrowerAuditOwner = {
  name: string;
  title: string | null;
  ownership_pct: number | null;
  confidence: number;
  source: string;
};

export type BorrowerAuditDocument = {
  document_id: string;
  type: string | null;
  filename: string | null;
  uploaded_at: string | null;
};

export type BorrowerAuditSnapshot = {
  schema_version: "1.0";
  generated_at: string;
  borrower: {
    id: string;
    legal_name: string | null;
    entity_type: string | null;
    ein_masked: string | null;
    naics_code: string | null;
    naics_description: string | null;
    address: BorrowerAuditAddress;
    state_of_formation: string | null;
  };
  owners: BorrowerAuditOwner[];
  extraction: {
    documents: BorrowerAuditDocument[];
    field_confidence: Record<string, number>;
  };
  attestation: {
    attested: boolean;
    attested_by: string | null;
    attested_at: string | null;
    snapshot_hash: string | null;
  };
  lifecycle: {
    borrower_created_at: string | null;
    borrower_completed_at: string | null;
  };
  ledger_refs: Array<{
    event_id: string;
    type: string;
    created_at: string;
  }>;
  snapshot_hash: string;
};

export async function buildBorrowerAuditSnapshot(args: {
  borrowerId: string;
  bankId: string;
  dealId?: string | null;
}): Promise<BorrowerAuditSnapshot> {
  const sb = supabaseAdmin();
  const generatedAt = new Date().toISOString();

  // 1) Load borrower
  const { data: borrowerRaw } = await sb
    .from("borrowers")
    .select(
      "id, legal_name, entity_type, ein, naics_code, naics_description, " +
      "address_line1, city, state, zip, state_of_formation, " +
      "extracted_confidence, created_at",
    )
    .eq("id", args.borrowerId)
    .eq("bank_id", args.bankId)
    .maybeSingle();

  if (!borrowerRaw) {
    throw new Error("borrower_not_found");
  }

  const borrower = borrowerRaw as any;

  // 2) Load owners
  const { data: owners } = await sb
    .from("borrower_owners")
    .select("full_name, title, ownership_percent, ownership_source, source_doc_id, extracted_at")
    .eq("borrower_id", args.borrowerId)
    .order("ownership_percent", { ascending: false });

  const extractedConf = (borrower.extracted_confidence ?? {}) as Record<string, number>;

  const auditOwners: BorrowerAuditOwner[] = (owners ?? []).map((o: any) => {
    const ownerKey = String(o.full_name ?? "").toLowerCase().replace(/\s+/g, "_");
    return {
      name: o.full_name ?? "",
      title: o.title ?? null,
      ownership_pct: o.ownership_percent ?? null,
      confidence: extractedConf[`owner.${ownerKey}`] ?? 0,
      source: o.ownership_source ?? "unknown",
    };
  });

  // 3) Load most recent attestation
  const { data: attestation } = await sb
    .from("borrower_owner_attestations")
    .select("id, attested_by_user_id, attested_at, snapshot")
    .eq("borrower_id", args.borrowerId)
    .order("attested_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const att = attestation as any;
  const attestationHash = att?.snapshot
    ? stableHash(att.snapshot)
    : null;

  // 4) Load source documents (documents that contributed to extraction)
  const dealId = args.dealId;
  let auditDocs: BorrowerAuditDocument[] = [];
  if (dealId) {
    const { data: docs } = await sb
      .from("deal_documents")
      .select("id, document_type, original_filename, created_at")
      .eq("deal_id", dealId)
      .eq("bank_id", args.bankId)
      .order("created_at", { ascending: true })
      .limit(50);

    auditDocs = (docs ?? []).map((d: any) => ({
      document_id: d.id,
      type: d.document_type ?? null,
      filename: d.original_filename ?? null,
      uploaded_at: d.created_at ?? null,
    }));
  }

  // 5) Load relevant ledger events
  let ledgerRefs: Array<{ event_id: string; type: string; created_at: string }> = [];
  if (dealId) {
    const { data: ledger } = await sb
      .from("deal_pipeline_ledger")
      .select("id, event_key, created_at")
      .eq("deal_id", dealId)
      .eq("bank_id", args.bankId)
      .like("event_key", "buddy.borrower.%")
      .order("created_at", { ascending: true })
      .limit(50);

    ledgerRefs = (ledger ?? []).map((e: any) => ({
      event_id: e.id,
      type: e.event_key,
      created_at: e.created_at,
    }));
  }

  // 6) Find lifecycle timestamps from ledger
  const completedEvent = ledgerRefs.find(
    (e) => e.type === "buddy.borrower.owners_attested",
  );

  // 7) Build deterministic snapshot (without hash — hash is computed from content)
  const snapshotBody = {
    schema_version: "1.0" as const,
    generated_at: generatedAt,
    borrower: {
      id: borrower.id,
      legal_name: borrower.legal_name ?? null,
      entity_type: borrower.entity_type ?? null,
      ein_masked: maskEinForAudit(borrower.ein),
      naics_code: borrower.naics_code ?? null,
      naics_description: borrower.naics_description ?? null,
      address: {
        line1: borrower.address_line1 ?? null,
        city: borrower.city ?? null,
        state: borrower.state ?? null,
        zip: borrower.zip ?? null,
      },
      state_of_formation: borrower.state_of_formation ?? null,
    },
    owners: auditOwners,
    extraction: {
      documents: auditDocs,
      field_confidence: extractedConf,
    },
    attestation: {
      attested: Boolean(att),
      attested_by: att?.attested_by_user_id ?? null,
      attested_at: att?.attested_at ?? null,
      snapshot_hash: attestationHash,
    },
    lifecycle: {
      borrower_created_at: borrower.created_at ?? null,
      borrower_completed_at: completedEvent?.created_at ?? null,
    },
    ledger_refs: ledgerRefs,
  };

  // 8) Compute snapshot hash from deterministic content
  const snapshotHash = stableHash(snapshotBody);

  return {
    ...snapshotBody,
    snapshot_hash: snapshotHash,
  };
}

/** Mask EIN for audit export — always shows XX-XXX{last4} */
function maskEinForAudit(ein: string | null | undefined): string | null {
  if (!ein) return null;
  const digits = String(ein).replace(/\D/g, "");
  if (digits.length < 4) return null;
  return `XX-XXX${digits.slice(-4)}`;
}
