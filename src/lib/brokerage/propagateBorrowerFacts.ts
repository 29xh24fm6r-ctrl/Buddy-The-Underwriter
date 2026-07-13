import "server-only";

/**
 * propagateBorrowerFacts — the bridge between the borrower conversation
 * (text concierge AND voice) and the SBA form-building pipeline.
 *
 * Originally propagateConciergeFacts (text-only, 3 tables). Arc 7 extends
 * it to also write into the tables the real form1919/413/912/4506-C/1244/
 * 148/155/601 input builders read from: borrowers, ownership_entities,
 * deal_loan_requests, borrower_applicant_financials. All new writes are
 * driven off BORROWER_FIELD_REGISTRY so the mapping lives in exactly one
 * place.
 *
 * Precedence: every new write is "fill if null" — a column already set
 * (by a banker, the intake wizard, or a prior propagation) is never
 * overwritten by conversation. The one exception is deal_financial_facts,
 * which keeps its pre-existing fact_type-based precedence (a document fact
 * always wins over a concierge fact; a concierge fact can update itself).
 *
 * Every write is independent and non-fatal — a failure is reported in the
 * result, never thrown, so the conversation never breaks because a
 * write-through failed.
 */

import {
  BORROWER_FIELD_REGISTRY,
  factKey,
  fieldsForScope,
  type BorrowerFieldEntry,
} from "@/lib/sba/forms/borrowerFieldRegistry";

export type BorrowerFacts = {
  borrower?: {
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
  business?: Record<string, unknown> | null;
  loan?: Record<string, unknown> | null;
  owners?: Array<Record<string, unknown>> | null;
  entities?: Array<Record<string, unknown>> | null;
};

/** @deprecated use BorrowerFacts */
export type ConciergeFacts = BorrowerFacts;

// A loosely-typed client, matching every other form input builder in this
// arc (e.g. form1919/inputBuilder.ts's Form1919InputBuilderClient) — needed
// because several selects here build their column list dynamically from
// the field registry, which supabase-js's generated types can't resolve
// against a literal-string overload.
export type BorrowerFactsClient = { from: (table: string) => any };

export type PropagationResult = {
  ok: boolean;
  wrote: string[];
  skipped: string[];
  errors: string[];
};

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function valueForType(raw: unknown, type: BorrowerFieldEntry["type"]): unknown {
  if (raw == null) return null;
  if (type === "number") {
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  if (type === "boolean") return typeof raw === "boolean" ? raw : null;
  if (typeof raw === "string") return raw.trim().length > 0 ? raw.trim() : null;
  return raw ?? null;
}

/** Registry-driven "only fill currently-null columns" patch builder. */
function buildFillIfNullPatch(
  entries: BorrowerFieldEntry[],
  facts: Record<string, unknown>,
  existingRow: Record<string, unknown> | null,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const entry of entries) {
    const value = valueForType(facts[factKey(entry)], entry.type);
    if (value == null) continue;
    if (existingRow && existingRow[entry.sourceColumn] != null) continue;
    patch[entry.sourceColumn] = value;
  }
  return patch;
}

export async function propagateBorrowerFacts(params: {
  dealId: string;
  bankId: string;
  facts: BorrowerFacts;
  sb: BorrowerFactsClient;
}): Promise<PropagationResult> {
  const { dealId, bankId, facts, sb } = params;
  const wrote: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  const businessFacts = (facts?.business ?? {}) as Record<string, unknown>;
  const loanFacts = (facts?.loan ?? {}) as Record<string, unknown>;

  const loanAmount = num(loanFacts["amount_requested"]);
  const useOfProceeds = str(loanFacts["use_of_proceeds"]);
  const legalName = str(businessFacts["legal_name"]);
  const naics = str(businessFacts["naics"]);
  const industry = str(businessFacts["industry_description"]);
  const state = str(businessFacts["state"]);

  // ── 1. deals — loan_amount / loan_type / state ───────────────────────
  let dealBorrowerId: string | null = null;
  try {
    const { data: deal } = await sb
      .from("deals")
      .select("loan_amount, loan_type, state, borrower_id")
      .eq("id", dealId)
      .maybeSingle();

    dealBorrowerId = (deal as { borrower_id?: string } | null)?.borrower_id ?? null;

    const patch: Record<string, unknown> = {};
    if (loanAmount != null && deal?.loan_amount == null) {
      patch.loan_amount = loanAmount;
    }
    if (deal && deal.loan_type == null) patch.loan_type = "7a";
    if (state && deal?.state == null) patch.state = state;

    if (Object.keys(patch).length > 0) {
      const { error } = await sb.from("deals").update(patch).eq("id", dealId);
      if (error) errors.push(`deals: ${error.message}`);
      else wrote.push(`deals(${Object.keys(patch).join(",")})`);
    } else {
      skipped.push("deals");
    }
  } catch (e) {
    errors.push(`deals: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ── 2. borrower_applications — upsert on deal_id ─────────────────────
  try {
    const app: Record<string, unknown> = { deal_id: dealId };
    if (legalName) app.business_legal_name = legalName;
    if (naics) app.naics = naics;
    if (industry) app.industry = industry;
    if (loanAmount != null) app.loan_amount = loanAmount;
    if (useOfProceeds) app.loan_purpose = useOfProceeds;
    app.loan_type = "7a";

    if (Object.keys(app).length > 2) {
      const { error } = await sb
        .from("borrower_applications")
        .upsert(app, { onConflict: "deal_id" });
      if (error) errors.push(`borrower_applications: ${error.message}`);
      else wrote.push("borrower_applications");
    } else {
      skipped.push("borrower_applications");
    }
  } catch (e) {
    errors.push(
      `borrower_applications: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // ── 3. deal_financial_facts — the keys the score engine reads ────────
  const factWrites: Array<{ key: string; value: number | null }> = [
    { key: "YEARS_IN_BUSINESS", value: num(businessFacts["years_in_business"]) },
    { key: "ANNUAL_REVENUE", value: num(businessFacts["annual_revenue"]) },
    { key: "EMPLOYEE_COUNT", value: num(businessFacts["employee_count"]) },
  ];

  for (const f of factWrites) {
    if (f.value == null) continue;
    try {
      const { data: existing } = await sb
        .from("deal_financial_facts")
        .select("id, fact_type, fact_value_num")
        .eq("deal_id", dealId)
        .eq("fact_key", f.key)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing && existing.fact_type !== "concierge") {
        skipped.push(`fact:${f.key} (document fact present)`);
        continue;
      }

      if (existing && existing.fact_type === "concierge") {
        if (Number(existing.fact_value_num) === f.value) {
          skipped.push(`fact:${f.key} (unchanged)`);
          continue;
        }
        const { error } = await sb
          .from("deal_financial_facts")
          .update({
            fact_value_num: f.value,
            provenance: { source: "concierge", updated: true },
          })
          .eq("id", existing.id);
        if (error) errors.push(`fact:${f.key}: ${error.message}`);
        else wrote.push(`fact:${f.key}`);
        continue;
      }

      const { error } = await sb.from("deal_financial_facts").insert({
        deal_id: dealId,
        bank_id: bankId,
        fact_type: "concierge",
        fact_key: f.key,
        fact_value_num: f.value,
        confidence: 0.7,
        provenance: { source: "concierge" },
      });
      if (error) errors.push(`fact:${f.key}: ${error.message}`);
      else wrote.push(`fact:${f.key}`);
    } catch (e) {
      errors.push(
        `fact:${f.key}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // ── 4. borrowers — business-scope registry fields, fill-if-null ──────
  // Only when the deal already has a linked borrower row (created by the
  // deal/application flow) — conversation extraction never creates one,
  // same convention as the intake wizard's "address" step.
  if (dealBorrowerId) {
    try {
      const businessEntries = fieldsForScope("business");
      const { data: existingBorrower } = await sb
        .from("borrowers")
        .select(businessEntries.map((e) => e.sourceColumn).join(", "))
        .eq("id", dealBorrowerId)
        .maybeSingle();

      const patch = buildFillIfNullPatch(
        businessEntries,
        businessFacts,
        (existingBorrower as Record<string, unknown>) ?? null,
      );

      if (Object.keys(patch).length > 0) {
        const { error } = await sb.from("borrowers").update(patch).eq("id", dealBorrowerId);
        if (error) errors.push(`borrowers: ${error.message}`);
        else wrote.push(`borrowers(${Object.keys(patch).join(",")})`);
      } else {
        skipped.push("borrowers");
      }
    } catch (e) {
      errors.push(`borrowers: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    skipped.push("borrowers (no borrower_id on deal)");
  }

  // ── 5. ownership_entities — per-owner upsert, fill-if-null ───────────
  // Matched by (deal_id, display_name), same as the intake wizard's
  // "owners" step (no unique constraint enables a real .upsert()).
  const ownerRegistryEntries = fieldsForScope("owner");
  const pfsRegistryEntries = fieldsForScope("pfs");
  const ownerIdByName = new Map<string, string>();

  for (const owner of facts?.owners ?? []) {
    const fullName = str((owner as Record<string, unknown>)["full_name"]);
    if (!fullName) continue;
    try {
      const { data: existing } = await sb
        .from("ownership_entities")
        .select(["id", ...ownerRegistryEntries.map((e) => e.sourceColumn)].join(", "))
        .eq("deal_id", dealId)
        .eq("display_name", fullName)
        .maybeSingle();

      const existingRow = (existing as Record<string, unknown>) ?? null;
      const patch = buildFillIfNullPatch(ownerRegistryEntries, owner as Record<string, unknown>, existingRow);

      if (existingRow?.id) {
        ownerIdByName.set(fullName, String(existingRow.id));
        if (Object.keys(patch).length > 0) {
          const { error } = await sb.from("ownership_entities").update(patch).eq("id", existingRow.id);
          if (error) errors.push(`ownership_entities(${fullName}): ${error.message}`);
          else wrote.push(`ownership_entities(${fullName})`);
        } else {
          skipped.push(`ownership_entities(${fullName})`);
        }
      } else {
        const insertPatch = buildFillIfNullPatch(ownerRegistryEntries, owner as Record<string, unknown>, null);
        const { data: inserted, error } = await sb
          .from("ownership_entities")
          .insert({
            deal_id: dealId,
            entity_type: "individual",
            display_name: fullName,
            confidence: 0.7,
            meta_json: { source: "concierge" },
            ...insertPatch,
          })
          .select("id")
          .maybeSingle();
        if (error) errors.push(`ownership_entities(${fullName}): ${error.message}`);
        else {
          wrote.push(`ownership_entities(${fullName}, new)`);
          if (inserted?.id) ownerIdByName.set(fullName, String(inserted.id));
        }
      }
    } catch (e) {
      errors.push(`ownership_entities(${fullName}): ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ── 6. ownership_entities — per-entity (equity-owning entity) upsert ─
  const entityRegistryEntries = fieldsForScope("entity");
  for (const entity of facts?.entities ?? []) {
    const legalNameEntity = str((entity as Record<string, unknown>)["legal_name"]);
    if (!legalNameEntity) continue;
    try {
      const { data: existing } = await sb
        .from("ownership_entities")
        .select(["id", ...entityRegistryEntries.map((e) => e.sourceColumn)].join(", "))
        .eq("deal_id", dealId)
        .eq("display_name", legalNameEntity)
        .maybeSingle();

      const existingRow = (existing as Record<string, unknown>) ?? null;
      const patch = buildFillIfNullPatch(entityRegistryEntries, entity as Record<string, unknown>, existingRow);

      if (existingRow?.id) {
        if (Object.keys(patch).length > 0) {
          const { error } = await sb.from("ownership_entities").update(patch).eq("id", existingRow.id);
          if (error) errors.push(`ownership_entities(${legalNameEntity}): ${error.message}`);
          else wrote.push(`ownership_entities(${legalNameEntity})`);
        } else {
          skipped.push(`ownership_entities(${legalNameEntity})`);
        }
      } else {
        const insertPatch = buildFillIfNullPatch(entityRegistryEntries, entity as Record<string, unknown>, null);
        const entityType = str((entity as Record<string, unknown>)["entity_type"]) ?? "llc";
        const { error } = await sb.from("ownership_entities").insert({
          deal_id: dealId,
          entity_type: entityType,
          display_name: legalNameEntity,
          confidence: 0.7,
          meta_json: { source: "concierge" },
          ...insertPatch,
        });
        if (error) errors.push(`ownership_entities(${legalNameEntity}): ${error.message}`);
        else wrote.push(`ownership_entities(${legalNameEntity}, new)`);
      }
    } catch (e) {
      errors.push(`ownership_entities(${legalNameEntity}): ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ── 7. deal_loan_requests — loan-scope registry fields, fill-if-null ─
  try {
    const loanEntries = fieldsForScope("loan").filter(
      (e) => e.sourceColumn !== "requested_amount" && e.sourceColumn !== "use_of_proceeds",
    );
    const { data: existingLoanRequest } = await sb
      .from("deal_loan_requests")
      .select(["id", ...loanEntries.map((e) => e.sourceColumn)].join(", "))
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingLoanRequest?.id) {
      const patch = buildFillIfNullPatch(loanEntries, loanFacts, existingLoanRequest as Record<string, unknown>);
      if (Object.keys(patch).length > 0) {
        const { error } = await sb.from("deal_loan_requests").update(patch).eq("id", existingLoanRequest.id);
        if (error) errors.push(`deal_loan_requests: ${error.message}`);
        else wrote.push(`deal_loan_requests(${Object.keys(patch).join(",")})`);
      } else {
        skipped.push("deal_loan_requests");
      }
    } else {
      skipped.push("deal_loan_requests (no row on deal yet)");
    }
  } catch (e) {
    errors.push(`deal_loan_requests: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ── 8. borrower_applicant_financials — per-owner PFS, fill-if-null ───
  for (const owner of facts?.owners ?? []) {
    const fullName = str((owner as Record<string, unknown>)["full_name"]);
    const pfs = (owner as Record<string, unknown>)["pfs"] as Record<string, unknown> | undefined;
    if (!fullName || !pfs) continue;
    const ownerId = ownerIdByName.get(fullName);
    if (!ownerId) continue;

    try {
      const { data: existing } = await sb
        .from("borrower_applicant_financials")
        .select(["applicant_id", ...pfsRegistryEntries.map((e) => e.sourceColumn)].join(", "))
        .eq("applicant_id", ownerId)
        .maybeSingle();

      const existingRow = (existing as Record<string, unknown>) ?? null;
      const patch = buildFillIfNullPatch(pfsRegistryEntries, pfs, existingRow);

      if (existingRow) {
        if (Object.keys(patch).length > 0) {
          const { error } = await sb
            .from("borrower_applicant_financials")
            .update(patch)
            .eq("applicant_id", ownerId);
          if (error) errors.push(`borrower_applicant_financials(${fullName}): ${error.message}`);
          else wrote.push(`borrower_applicant_financials(${fullName})`);
        } else {
          skipped.push(`borrower_applicant_financials(${fullName})`);
        }
      } else {
        const insertPatch = buildFillIfNullPatch(pfsRegistryEntries, pfs, null);
        if (Object.keys(insertPatch).length > 0) {
          const { error } = await sb.from("borrower_applicant_financials").insert({
            applicant_id: ownerId,
            captured_at: new Date().toISOString(),
            ...insertPatch,
          });
          if (error) errors.push(`borrower_applicant_financials(${fullName}): ${error.message}`);
          else wrote.push(`borrower_applicant_financials(${fullName}, new)`);
        } else {
          skipped.push(`borrower_applicant_financials(${fullName})`);
        }
      }
    } catch (e) {
      errors.push(`borrower_applicant_financials(${fullName}): ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { ok: errors.length === 0, wrote, skipped, errors };
}

export { BORROWER_FIELD_REGISTRY };
