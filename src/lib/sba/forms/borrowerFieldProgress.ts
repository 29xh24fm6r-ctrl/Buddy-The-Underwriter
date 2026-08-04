import {
  BORROWER_FIELD_REGISTRY,
  factKey,
  type BorrowerFieldEntry,
  type BorrowerFieldEntityScope,
} from "./borrowerFieldRegistry";
import { OC_REQUIRED_WHEN_EPC_KEYS } from "./form1244/build";

const OC_KEYS = new Set(OC_REQUIRED_WHEN_EPC_KEYS);

const CONDITIONAL_GATES: Array<{
  keys: Set<string>;
  gateFact: (facts: Record<string, unknown>) => boolean;
  promotesToRequiredFor?: string[];
}> = [
  {
    keys: new Set(["spouse_full_name", "spouse_full_ssn"]),
    gateFact: (facts) => {
      const owners = facts.owners as Array<Record<string, unknown>> | undefined;
      return owners?.some((o) => o.has_spouse === true) ?? false;
    },
  },
  {
    keys: OC_KEYS,
    gateFact: (facts) => {
      const loan = facts.loan as Record<string, unknown> | undefined;
      return loan?.is_eligible_passive_company === true;
    },
    promotesToRequiredFor: ["1244"],
  },
  {
    keys: new Set(["arrest_explanation"]),
    gateFact: (facts) => {
      const owners = facts.owners as Array<Record<string, unknown>> | undefined;
      return owners?.some((o) => o.arrested_or_charged_6mo === true) ?? false;
    },
  },
  {
    keys: new Set(["conviction_explanation"]),
    gateFact: (facts) => {
      const owners = facts.owners as Array<Record<string, unknown>> | undefined;
      return owners?.some((o) => o.convicted_or_pleaded === true || o.convicted_diversion_or_parole === true) ?? false;
    },
  },
  {
    keys: new Set(["indictment_explanation"]),
    gateFact: (facts) => {
      const owners = facts.owners as Array<Record<string, unknown>> | undefined;
      return owners?.some((o) => o.subject_to_indictment === true) ?? false;
    },
  },
  {
    keys: new Set(["parole_explanation"]),
    gateFact: (facts) => {
      const owners = facts.owners as Array<Record<string, unknown>> | undefined;
      return owners?.some((o) => o.on_parole_or_probation === true) ?? false;
    },
  },
  {
    keys: new Set(["prior_cdc_lender_name_and_program"]),
    gateFact: (facts) => {
      const biz = facts.business as Record<string, unknown> | undefined;
      return biz?.prior_application_submitted === true;
    },
  },
  {
    keys: new Set(["sba_loan_entity_interest_details"]),
    gateFact: (facts) => {
      const owners = facts.owners as Array<Record<string, unknown>> | undefined;
      return owners?.some((o) => o.sba_loan_entity_interest === true) ?? false;
    },
  },
  {
    keys: new Set([
      "guarantee_limitation_type",
      "guarantee_limit_balance_under",
      "guarantee_limit_principal_under",
      "guarantee_limit_max_payment",
      "guarantee_limit_percent_payment",
      "guarantee_limit_time_years",
      "guarantee_limit_collateral_description",
    ]),
    gateFact: (facts) => {
      const owners = facts.owners as Array<Record<string, unknown>> | undefined;
      if (!owners) return false;
      return owners.some((o) => {
        const pct = Number(o.ownership_pct);
        return Number.isFinite(pct) && pct > 0 && pct < 20;
      });
    },
  },
];

const PII_VAULT_KEYS = new Set(["full_ssn", "spouse_full_ssn"]);

const SCOPE_TO_CHAPTER: Record<BorrowerFieldEntityScope, 1 | 2 | 3 | 4 | 5> = {
  loan: 1,
  business: 2,
  owner: 3,
  entity: 3,
  pfs: 4,
};

export type FieldProgress = {
  requiredTotal: number;
  completedCount: number;
  remainingFactPaths: string[];
  byChapter: Record<1 | 2 | 3 | 4 | 5, { total: number; complete: number }>;
  excluded: string[];
  determinable: boolean;
};

function isFieldGated(entry: BorrowerFieldEntry, facts: Record<string, unknown>): boolean {
  for (const gate of CONDITIONAL_GATES) {
    if (gate.keys.has(entry.key) && !gate.gateFact(facts)) {
      return true;
    }
  }
  return false;
}

function scopeInstances(
  scope: BorrowerFieldEntityScope,
  facts: Record<string, unknown>,
): Array<Record<string, unknown>> {
  switch (scope) {
    case "business":
    case "loan":
      return [facts[scope] as Record<string, unknown> ?? {}];
    case "owner":
    case "pfs": {
      const owners = facts.owners as Array<Record<string, unknown>> | undefined;
      if (!owners?.length) return [{}];
      if (scope === "pfs") return owners.map((o) => (o.pfs as Record<string, unknown>) ?? {});
      return owners;
    }
    case "entity": {
      const entities = facts.entities as Array<Record<string, unknown>> | undefined;
      if (!entities?.length) return [{}];
      return entities;
    }
  }
}

function isFieldComplete(
  entry: BorrowerFieldEntry,
  scopeObj: Record<string, unknown>,
): boolean {
  if (PII_VAULT_KEYS.has(entry.key)) return false;
  const key = factKey(entry);
  const val = scopeObj[key];
  if (val === undefined || val === null || val === "") return false;
  return true;
}

export function computeFieldProgress(
  facts: Record<string, unknown>,
  formCodes: string[],
): FieldProgress {
  if (formCodes.length === 0) {
    return {
      requiredTotal: 0,
      completedCount: 0,
      remainingFactPaths: [],
      byChapter: {
        1: { total: 0, complete: 0 },
        2: { total: 0, complete: 0 },
        3: { total: 0, complete: 0 },
        4: { total: 0, complete: 0 },
        5: { total: 0, complete: 0 },
      },
      excluded: ["no_form_codes"],
      determinable: false,
    };
  }

  const excluded: string[] = [];
  excluded.push("pii_vault_unchecked");
  excluded.push("pfs_schedules_unmodeled");

  const formSet = new Set(formCodes);

  const requiredEntries = BORROWER_FIELD_REGISTRY.filter((entry) => {
    if (PII_VAULT_KEYS.has(entry.key)) return false;
    if (isFieldGated(entry, facts)) return false;

    if (entry.requiredForForms.length > 0) {
      return entry.requiredForForms.some((f) => formSet.has(f));
    }

    for (const gate of CONDITIONAL_GATES) {
      if (gate.promotesToRequiredFor && gate.keys.has(entry.key) && gate.gateFact(facts)) {
        return gate.promotesToRequiredFor.some((f) => formSet.has(f));
      }
    }
    return false;
  });

  const needsOwners = requiredEntries.some((e) => e.entityScope === "owner" || e.entityScope === "pfs");
  const owners = facts.owners as Array<unknown> | undefined;
  if (needsOwners && (!owners || owners.length === 0)) {
    excluded.push("owners_empty");
    return {
      requiredTotal: 0,
      completedCount: 0,
      remainingFactPaths: [],
      byChapter: {
        1: { total: 0, complete: 0 },
        2: { total: 0, complete: 0 },
        3: { total: 0, complete: 0 },
        4: { total: 0, complete: 0 },
        5: { total: 0, complete: 0 },
      },
      excluded,
      determinable: false,
    };
  }

  const byChapter: Record<1 | 2 | 3 | 4 | 5, { total: number; complete: number }> = {
    1: { total: 0, complete: 0 },
    2: { total: 0, complete: 0 },
    3: { total: 0, complete: 0 },
    4: { total: 0, complete: 0 },
    5: { total: 0, complete: 0 },
  };

  let requiredTotal = 0;
  let completedCount = 0;
  const remainingFactPaths: string[] = [];

  for (const entry of requiredEntries) {
    const chapter = SCOPE_TO_CHAPTER[entry.entityScope];
    const instances = scopeInstances(entry.entityScope, facts);

    for (let i = 0; i < instances.length; i++) {
      requiredTotal++;
      byChapter[chapter].total++;

      if (isFieldComplete(entry, instances[i])) {
        completedCount++;
        byChapter[chapter].complete++;
      } else {
        remainingFactPaths.push(entry.factPath);
      }
    }
  }

  return {
    requiredTotal,
    completedCount,
    remainingFactPaths,
    byChapter,
    excluded,
    determinable: true,
  };
}
