import "server-only";
import { requiredFieldsForForm } from "@/lib/sba/forms/borrowerFieldRegistry";
type SB = {
  from: (table: string) => any;
};
export type FormCompletenessResult = {
  complete: boolean;
  missingRequired: string[];
  unmatchedFields: string[];
};
/** Read each required field from its declared table, including the PII vault.
 * This is field completeness, not signature or lender approval. Unknown forms
 * cannot be certified by an empty registry. */
export async function assertFormComplete(
  formCode: string,
  dealId: string,
  sb: SB,
  signerId?: string,
): Promise<FormCompletenessResult> {
  let code = formCode.replace(/^(SBA_|IRS_|FORM_)/, "").toLowerCase();
  if (code === "148l") code = "148";
  const fields = requiredFieldsForForm(code);
  if (!fields.length)
    return {
      complete: false,
      missingRequired: [],
      unmatchedFields: [`unconfigured_form:${formCode}`],
    };
  const missing: string[] = [];
  const unmatched: string[] = [];
  const deal = await sb
    .from("deals")
    .select("borrower_id")
    .eq("id", dealId)
    .maybeSingle();
  const ownerResult = await sb
    .from("ownership_entities")
    .select("*")
    .eq("deal_id", dealId);
  if (deal.error || ownerResult.error)
    return {
      complete: false,
      missingRequired: [],
      unmatchedFields: ["canonical_read_failed"],
    };
  const owners = (ownerResult.data ?? []) as Record<string, any>[];
  if (signerId && !owners.some((o) => o.id === signerId))
    return {
      complete: false,
      missingRequired: ["signer_not_in_deal"],
      unmatchedFields: [],
    };
  const cache = new Map<string, Record<string, any>[]>();
  cache.set("ownership_entities", owners);
  for (const table of new Set(fields.map((f) => f.sourceTable))) {
    if (cache.has(table)) continue;
    let query = sb
      .from(table)
      .select(
        table === "deal_pii_records" ? "ownership_entity_id,pii_type" : "*",
      );
    if (table === "deals") query = query.eq("id", dealId);
    else if (table === "borrowers") {
      if (!deal.data?.borrower_id) {
        cache.set(table, []);
        continue;
      }
      query = query.eq("id", deal.data.borrower_id);
    } else if (table !== "borrower_applicant_financials")
      query = query.eq("deal_id", dealId);
    else {
      if (!owners.length) {
        cache.set(table, []);
        continue;
      }
      query = sb
        .from("borrower_applicant_financials")
        .select("*")
        .in(
          "applicant_id",
          owners.map((o) => o.id),
        );
    }
    if (table === "deal_loan_requests")
      query = query.order("created_at", { ascending: false }).limit(1);
    const result = await query;
    if (result.error) unmatched.push(`read_failed:${table}`);
    cache.set(table, result.data ?? []);
  }
  for (const field of fields) {
    const ownerScoped = ["owner", "entity", "pfs"].includes(field.entityScope);
    const instances = ownerScoped
      ? owners.filter(
          (o) =>
            (!signerId || o.id === signerId) &&
            (field.entityScope === "entity"
              ? !["individual", "person"].includes(o.entity_type)
              : ["individual", "person"].includes(o.entity_type)) &&
            (field.entityScope !== "pfs" || Number(o.ownership_pct ?? 0) >= 20),
        )
      : [null];
    if (!instances.length && field.entityScope !== "entity") {
      missing.push(field.key);
      continue;
    }
    for (const owner of instances) {
      if (field.key === "spouse_full_ssn" && owner?.has_spouse !== true)
        continue;
      const rows = cache.get(field.sourceTable) ?? [];
      const row = rows.find(
        (r) =>
          !owner ||
          (field.sourceTable === "ownership_entities"
            ? r.id === owner.id
            : field.sourceTable === "deal_pii_records"
              ? r.ownership_entity_id === owner.id && r.pii_type === field.key
              : r.applicant_id === owner.id),
      );
      const value =
        field.sourceTable === "deal_pii_records"
          ? row?.pii_type
          : row?.[field.sourceColumn];
      if (value == null || value === "")
        missing.push(`${field.key}${owner ? ":" + owner.id : ""}`);
    }
  }
  return {
    complete: missing.length === 0 && unmatched.length === 0,
    missingRequired: missing,
    unmatchedFields: unmatched,
  };
}
