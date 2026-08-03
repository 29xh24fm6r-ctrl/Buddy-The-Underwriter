import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { requiredFieldsForForm, type BorrowerFieldEntry } from "@/lib/sba/forms/borrowerFieldRegistry";

type SB = { from: (table: string) => any };

/**
 * Maps from any form-code convention (SBA_1919, FORM_1919, 1919) to
 * the bare registry code ("1919").
 */
function toRegistryCode(formCode: string): string {
  return formCode
    .replace(/^SBA_/, "")
    .replace(/^IRS_/, "")
    .replace(/^FORM_/, "")
    .replace(/^SBA_NOTE$/, "sba_note")
    .replace(/^AUTHORIZATION$/, "authorization")
    .toLowerCase();
}

const TEMPLATE_CODE_MAP: Record<string, string> = {
  SBA_1919: "1919",
  SBA_1244: "1244",
  SBA_413: "413",
  SBA_912: "912",
  SBA_155: "155",
  SBA_601: "601",
  SBA_148: "148",
  SBA_148L: "148",
  IRS_4506C: "4506c",
  SBA_NOTE: "sba_note",
  SBA_AUTHORIZATION: "authorization",
  SBA_722: "722",
  FORM_1919: "1919",
  FORM_1244: "1244",
  FORM_413: "413",
  FORM_912: "912",
  FORM_155: "155",
  FORM_601: "601",
  FORM_148: "148",
  FORM_148L: "148",
  FORM_4506C: "4506c",
  FORM_SBA_NOTE: "sba_note",
  FORM_SBA_AUTHORIZATION: "authorization",
  FORM_722: "722",
};

function resolveRegistryCode(formCode: string): string {
  return TEMPLATE_CODE_MAP[formCode] ?? formCode;
}

export type FormCompletenessResult = {
  complete: boolean;
  missingRequired: string[];
  unmatchedFields: string[];
};

/**
 * §7a — Completeness gate. Returns whether a form is fully complete for
 * a given deal (and optionally a specific signer). A form is complete
 * only when every requiredForForms field is non-null in canonical state.
 */
export async function assertFormComplete(
  formCode: string,
  dealId: string,
  sb: SB,
  signerId?: string,
): Promise<FormCompletenessResult> {
  const registryCode = resolveRegistryCode(formCode);
  const requiredFields = requiredFieldsForForm(registryCode);

  if (requiredFields.length === 0) {
    return { complete: true, missingRequired: [], unmatchedFields: [] };
  }

  const missing: string[] = [];

  const byScope = groupByScope(requiredFields);

  if (byScope.business.length > 0) {
    const cols = [...new Set(byScope.business.map((f) => f.sourceColumn))];
    const { data: deal } = await sb.from("deals").select("borrower_id").eq("id", dealId).maybeSingle();
    const borrowerId = (deal as { borrower_id?: string } | null)?.borrower_id;
    if (borrowerId) {
      const { data: row } = await sb.from("borrowers").select(cols.join(", ")).eq("id", borrowerId).maybeSingle();
      for (const field of byScope.business) {
        const val = (row as Record<string, unknown> | null)?.[field.sourceColumn];
        if (val == null || val === "") missing.push(field.key);
      }
    } else {
      missing.push(...byScope.business.map((f) => f.key));
    }
  }

  if (byScope.owner.length > 0) {
    const cols = [...new Set(byScope.owner.map((f) => f.sourceColumn))];
    if (signerId) {
      const { data: row } = await sb
        .from("ownership_entities")
        .select(cols.join(", "))
        .eq("id", signerId)
        .maybeSingle();
      for (const field of byScope.owner) {
        const val = (row as Record<string, unknown> | null)?.[field.sourceColumn];
        if (val == null || val === "") missing.push(field.key);
      }
    } else {
      const { data: rows } = await sb
        .from("ownership_entities")
        .select(`id, entity_type, ${cols.join(", ")}`)
        .eq("deal_id", dealId);
      const individuals = ((rows ?? []) as Array<Record<string, any>>).filter(
        (r) => r.entity_type === "individual" || r.entity_type === "person",
      );
      if (individuals.length === 0) {
        missing.push(...byScope.owner.map((f) => f.key));
      } else {
        for (const owner of individuals) {
          for (const field of byScope.owner) {
            const val = owner[field.sourceColumn];
            if (val == null || val === "") {
              const key = `${field.key}:${owner.id}`;
              if (!missing.includes(key)) missing.push(key);
            }
          }
        }
      }
    }
  }

  if (byScope.loan.length > 0) {
    const cols = [...new Set(byScope.loan.map((f) => f.sourceColumn))];
    const { data: row } = await sb
      .from("deal_loan_requests")
      .select(cols.join(", "))
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    for (const field of byScope.loan) {
      const val = (row as Record<string, unknown> | null)?.[field.sourceColumn];
      if (val == null || val === "") missing.push(field.key);
    }
  }

  if (byScope.pfs.length > 0) {
    const cols = [...new Set(byScope.pfs.map((f) => f.sourceColumn))];
    if (signerId) {
      const { data: row } = await sb
        .from("borrower_applicant_financials")
        .select(cols.join(", "))
        .eq("ownership_entity_id", signerId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      for (const field of byScope.pfs) {
        const val = (row as Record<string, unknown> | null)?.[field.sourceColumn];
        if (val == null || val === "") missing.push(field.key);
      }
    }
  }

  return {
    complete: missing.length === 0,
    missingRequired: missing,
    unmatchedFields: [],
  };
}

function groupByScope(fields: BorrowerFieldEntry[]) {
  const business: BorrowerFieldEntry[] = [];
  const owner: BorrowerFieldEntry[] = [];
  const entity: BorrowerFieldEntry[] = [];
  const loan: BorrowerFieldEntry[] = [];
  const pfs: BorrowerFieldEntry[] = [];

  for (const f of fields) {
    switch (f.entityScope) {
      case "business": business.push(f); break;
      case "owner": owner.push(f); break;
      case "entity": entity.push(f); break;
      case "loan": loan.push(f); break;
      case "pfs": pfs.push(f); break;
    }
  }

  return { business, owner, entity, loan, pfs };
}
