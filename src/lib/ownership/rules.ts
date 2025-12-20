// src/lib/ownership/rules.ts

export const OWNER_THRESHOLD_PERCENT = 20;

export function requiresPersonalPackage(ownershipPercent: number | null | undefined) {
  if (ownershipPercent == null) return false;
  return Number(ownershipPercent) >= OWNER_THRESHOLD_PERCENT;
}

export function deriveOwnerRequirementsFromPct(pct: number) {
  // Your bank + SBA baseline: >=20% => PFS + 3 yrs personal returns + personal guaranty
  if (pct >= 20) {
    return ["PFS", "PersonalTaxReturns_3Y", "PersonalGuaranty"];
  }
  // You can add tiered rules later
  return [];
}

// Borrower-friendly labels (no SBA jargon on borrower side)
export function ownerChecklistTemplate(year0 = new Date().getFullYear()) {
  const y1 = year0 - 1;
  const y2 = year0 - 2;

  return [
    {
      code: "PFS",
      title: "Personal Financial Statement",
      description: "A snapshot of your personal assets and liabilities. If this is new to you, no worries — we'll guide you.",
      sort_order: 10,
      required: true,
      match_hints: ["personal financial statement", "pfs", "statement of personal financial condition", "SBA Form 413", "413"],
    },
    {
      code: `PERS_TAX_${year0}`,
      title: `Personal tax return (${year0})`,
      description: "Upload the complete return (all pages + schedules).",
      sort_order: 20,
      required: true,
      match_hints: ["1040", "tax return", "schedule", "w-2", "k-1", "irs"],
    },
    {
      code: `PERS_TAX_${y1}`,
      title: `Personal tax return (${y1})`,
      description: "Upload the complete return (all pages + schedules).",
      sort_order: 30,
      required: true,
      match_hints: ["1040", "tax return", "schedule", "irs"],
    },
    {
      code: `PERS_TAX_${y2}`,
      title: `Personal tax return (${y2})`,
      description: "Upload the complete return (all pages + schedules).",
      sort_order: 40,
      required: true,
      match_hints: ["1040", "tax return", "schedule", "irs"],
    },
    {
      code: "PERSONAL_GUARANTY",
      title: "Personal guaranty",
      description: "A standard form — we'll provide it and help you complete it.",
      sort_order: 50,
      required: true,
      match_hints: ["guaranty", "guarantee", "personal guaranty", "SBA Form 148", "148"],
    },
  ];
}
