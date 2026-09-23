/** Source evidence comes from the same immutable snapshot as the generated package. */
export type PackageSourceDocument = {
  id: string; deal_id: string; bank_id?: string | null; source: string;
  original_filename?: string | null; storage_bucket?: string | null;
  storage_path: string; size_bytes: number; sha256?: string | null;
  canonical_type?: string | null; document_type?: string | null;
  doc_year?: number | null; doc_years?: number[] | null;
  intake_status?: string | null; quality_status?: string | null; finalized_at?: string | null;
};
export function packageSourceDocuments(
  snapshot: unknown, dealId: string, bankId: string, actor: "borrower" | "lender",
): PackageSourceDocument[] {
  const rows = (snapshot as { sources?: { documents?: unknown } } | null)?.sources?.documents;
  if (!Array.isArray(rows)) throw new Error("Package source evidence is unavailable. Prepare the package again before downloading.");
  const selected = rows.filter(row => {
    if (!row || typeof row !== "object") throw new Error("Package source evidence is invalid.");
    if (row.deal_id !== dealId || (row.bank_id && row.bank_id !== bankId))
      throw new Error("Package source evidence does not match this application.");
    return row.is_active === true && row.status !== "withdrawn" &&
      (actor === "borrower" ? ["borrower", "borrower_portal"] : ["borrower", "borrower_portal", "internal", "public"]).includes(row.source);
  });
  const ids = new Set<string>();
  for (const doc of selected) {
    if (typeof doc.id !== "string" || !doc.id || ids.has(doc.id) ||
        typeof doc.storage_path !== "string" || !doc.storage_path.trim() ||
        !Number.isSafeInteger(doc.size_bytes) || doc.size_bytes <= 0 ||
        (doc.sha256 && !/^[a-f0-9]{64}$/i.test(doc.sha256)))
      throw new Error("A source document is missing its stored file identity. Resolve the upload before downloading.");
    ids.add(doc.id);
  }
  return selected.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
