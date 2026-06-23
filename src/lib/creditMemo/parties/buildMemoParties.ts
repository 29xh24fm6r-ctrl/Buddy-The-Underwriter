/**
 * Elite Credit Memo — Party Identity Builder
 *
 * Produces committee-grade borrower/guarantor identification.
 * No "Borrower" or "Hunt" as guarantor labels.
 *
 * Pure function — no DB, no server-only.
 */

export type GuarantorEntry = {
  name: string;
  type: "individual" | "entity";
  role: string;
  ownership_pct: number | null;
  verification_status: "verified" | "pending_verification";
  source: string;
};

export type MemoParties = {
  borrower_name: string;
  operating_company: string | null;
  guarantors: GuarantorEntry[];
  guarantor_display: string[];
  pending_guarantor_items: string[];
};

export type ManagementProfileInput = {
  person_name: string;
  title?: string | null;
  ownership_pct?: number | null;
};

export type OwnerEntityInput = {
  id: string;
  display_name?: string | null;
  ownership_pct?: number | null;
  title?: string | null;
  entity_type?: string | null;
};

/**
 * Returns true if this name is the borrower itself or a generic placeholder.
 * Does NOT filter non-borrower entity names (they may be legitimate entity guarantors).
 */
function isBorrowerOrPlaceholder(name: string, borrowerName: string | null): boolean {
  if (!name) return true;
  const lower = name.toLowerCase().trim();
  if (lower === "borrower" || lower === "unknown") return true;
  const borrowerLower = (borrowerName ?? "").toLowerCase().trim();
  if (borrowerLower && lower === borrowerLower) return true;
  return false;
}

function formatGuarantorLine(g: GuarantorEntry): string {
  const parts = [g.name];
  if (g.role) parts.push(`— ${g.role}`);
  if (g.ownership_pct !== null) parts.push(`${g.ownership_pct}% Owner`);
  if (g.verification_status === "pending_verification") parts.push("(verification pending)");
  return parts.join(", ").replace(/, —/, " —");
}

export function buildMemoParties(args: {
  borrowerName: string;
  dealDisplayName: string | null;
  managementProfiles: ManagementProfileInput[];
  ownerEntities: OwnerEntityInput[];
  bankerNotes: string | null;
}): MemoParties {
  const { borrowerName, dealDisplayName, managementProfiles, ownerEntities, bankerNotes } = args;

  const guarantors: GuarantorEntry[] = [];
  const coveredNames = new Set<string>();

  // Step 1: Build from management profiles (authoritative person data)
  for (const p of managementProfiles) {
    const name = p.person_name;
    if (!name || isBorrowerOrPlaceholder(name, borrowerName)) continue;
    coveredNames.add(name.toLowerCase().trim());
    const tokens = name.toLowerCase().trim().split(/\s+/);
    if (tokens.length > 0) coveredNames.add(tokens[tokens.length - 1]);

    guarantors.push({
      name,
      type: "individual",
      role: p.title ? `Individual Guarantor, ${p.title}` : "Individual Guarantor",
      ownership_pct: p.ownership_pct ?? null,
      verification_status: "verified",
      source: "deal_management_profiles",
    });
  }

  // Step 2: Add individual owners not already covered
  for (const o of ownerEntities) {
    const name = o.display_name ?? "";
    if (!name || isBorrowerOrPlaceholder(name, borrowerName)) continue;
    const lower = name.toLowerCase().trim();
    if (coveredNames.has(lower)) continue;
    // Single-token surname dedupe
    if (!lower.includes(" ") && coveredNames.has(lower)) continue;

    guarantors.push({
      name,
      type: o.entity_type === "individual" || o.entity_type === "person" ? "individual" : "entity",
      role: o.title ?? "Guarantor",
      ownership_pct: o.ownership_pct ?? null,
      verification_status: "pending_verification",
      source: "ownership_entities",
    });
  }

  const pending: string[] = [];
  if (guarantors.length === 0) {
    pending.push("Guarantor identity pending — obtain personal guaranty from principal owner(s).");
  }

  // Check banker notes for spouse/additional guarantor hints
  if (bankerNotes) {
    const lower = bankerNotes.toLowerCase();
    if (/spouse|wife|husband|co-guarantor/.test(lower) && !guarantors.some((g) => /spouse/i.test(g.role))) {
      pending.push("Potential spousal guaranty noted in banker context — verify requirement per bank policy.");
    }
  }

  return {
    borrower_name: borrowerName,
    operating_company: dealDisplayName !== borrowerName ? dealDisplayName : null,
    guarantors,
    guarantor_display: guarantors.map(formatGuarantorLine),
    pending_guarantor_items: pending,
  };
}
