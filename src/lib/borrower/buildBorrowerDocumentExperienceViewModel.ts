/**
 * Borrower Intelligent Upload & Document Experience — View Model Builder
 *
 * Deterministic, pure-function layer that translates real document/checklist
 * state into a borrower-safe document experience. No fake OCR claims, no
 * invented completeness, no approval promises.
 *
 * Spec: 15I / Spec 5 — Intelligent Upload & Document Experience
 *
 * Rules:
 * - Pure function, no DB or network calls
 * - Deterministic ordering for testability
 * - Borrower-safe copy only (no internal enums or status leakage)
 * - Safe fallback for unknown document types
 * - Reassurance copy only when actual state supports it
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BorrowerDocumentStatus =
  | "missing"
  | "uploaded"
  | "received"
  | "reviewing"
  | "accepted"
  | "needs_attention"
  | "optional"
  | "unavailable";

export type BorrowerDocumentGroupId =
  | "business_financials"
  | "tax_returns"
  | "sba_forms"
  | "ownership_identity"
  | "business_documents"
  | "supporting_documents";

export type BorrowerDocumentGuidance = {
  label: string;
  whyItMatters: string;
  helpfulUploadHint: string;
  commonIssueToAvoid?: string;
  acceptedFormatsCopy?: string;
};

export type BorrowerDocumentRequirement = {
  id: string;
  groupId: BorrowerDocumentGroupId;
  label: string;
  status: BorrowerDocumentStatus;
  statusLabel: string;
  required: boolean;
  guidance: BorrowerDocumentGuidance;
  ctaLabel?: string;
  href?: string;
  latestUploadedAt?: string;
  uploadCount?: number;
  reassurance?: string;
  recoveryMessage?: string;
};

export type BorrowerDocumentGroup = {
  id: BorrowerDocumentGroupId;
  label: string;
  description: string;
  requiredCount: number;
  receivedCount: number;
  needsAttentionCount: number;
  requirements: BorrowerDocumentRequirement[];
};

export type BorrowerDocumentPackageSummary = {
  requiredTotal: number;
  requiredReceived: number;
  requiredRemaining: number;
  optionalReceived: number;
  needsAttention: number;
  summary: string;
};

export type BorrowerDocumentExperienceViewModel = {
  packageSummary: BorrowerDocumentPackageSummary;
  groups: BorrowerDocumentGroup[];
  primaryAttentionItems: BorrowerDocumentRequirement[];
};

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type BorrowerDocumentItemInput = {
  id: string;
  title: string;
  required: boolean;
  group?: string | null;
  status: BorrowerDocumentStatus;
  uploadCount?: number;
  latestUploadedAt?: string | null;
};

export type DocumentExperienceInput = {
  /** Token for upload links */
  token: string;

  /** Items derived from checklist + document state (real state only). */
  items: BorrowerDocumentItemInput[];

  /** Max items in the primaryAttentionItems list. Default: 3. */
  maxPrimaryAttention?: number;
};

// ---------------------------------------------------------------------------
// Group definitions (fixed deterministic order)
// ---------------------------------------------------------------------------

type GroupDefinition = {
  id: BorrowerDocumentGroupId;
  label: string;
  description: string;
};

const GROUP_ORDER: BorrowerDocumentGroupId[] = [
  "business_financials",
  "tax_returns",
  "sba_forms",
  "ownership_identity",
  "business_documents",
  "supporting_documents",
];

const GROUP_DEFINITIONS: Record<BorrowerDocumentGroupId, GroupDefinition> = {
  business_financials: {
    id: "business_financials",
    label: "Business financials",
    description:
      "Recent statements that show how the business is performing today.",
  },
  tax_returns: {
    id: "tax_returns",
    label: "Tax returns",
    description:
      "Filed federal returns Buddy uses to verify reported income.",
  },
  sba_forms: {
    id: "sba_forms",
    label: "SBA forms",
    description:
      "Standard SBA forms required as part of the application package.",
  },
  ownership_identity: {
    id: "ownership_identity",
    label: "Ownership & identity",
    description:
      "Documents that confirm ownership structure and identity for each guarantor.",
  },
  business_documents: {
    id: "business_documents",
    label: "Business documents",
    description:
      "Operating documents like leases, agreements, and licenses.",
  },
  supporting_documents: {
    id: "supporting_documents",
    label: "Supporting documents",
    description:
      "Additional items Buddy may request to round out your package.",
  },
};

// ---------------------------------------------------------------------------
// Group classification
// ---------------------------------------------------------------------------

function classifyGroup(
  title: string,
  inputGroup?: string | null,
): BorrowerDocumentGroupId {
  const haystack = `${inputGroup ?? ""} ${title}`.toLowerCase();

  if (
    haystack.includes("tax return") ||
    haystack.includes("1040") ||
    haystack.includes("1120") ||
    haystack.includes("1065") ||
    haystack.includes("k-1") ||
    haystack.includes("k1") ||
    haystack.includes("schedule c")
  ) {
    return "tax_returns";
  }

  if (
    haystack.includes("sba form") ||
    haystack.includes("1919") ||
    haystack.includes("413") ||
    haystack.includes("personal financial statement") ||
    haystack.includes("pfs") ||
    haystack.includes("etran") ||
    haystack.includes("authorization")
  ) {
    return "sba_forms";
  }

  if (
    haystack.includes("driver") ||
    haystack.includes("license") && (haystack.includes("id") || haystack.includes("driver")) ||
    haystack.includes("passport") ||
    haystack.includes("identity") ||
    haystack.includes("government id") ||
    haystack.includes("ownership") ||
    haystack.includes("owner") ||
    haystack.includes("operating agreement") ||
    haystack.includes("articles of incorporation") ||
    haystack.includes("entity") ||
    haystack.includes("formation")
  ) {
    return "ownership_identity";
  }

  if (
    haystack.includes("profit") ||
    haystack.includes("p&l") ||
    haystack.includes("p & l") ||
    haystack.includes("income statement") ||
    haystack.includes("balance sheet") ||
    haystack.includes("debt schedule") ||
    haystack.includes("bank statement") ||
    haystack.includes("financial statement") ||
    haystack.includes("ar aging") ||
    haystack.includes("accounts receivable") ||
    haystack.includes("payroll")
  ) {
    return "business_financials";
  }

  if (
    haystack.includes("lease") ||
    haystack.includes("purchase agreement") ||
    haystack.includes("letter of intent") ||
    haystack.includes("loi") ||
    haystack.includes("franchise") ||
    haystack.includes("business license") ||
    haystack.includes("business registration") ||
    haystack.includes("insurance") ||
    haystack.includes("permit") ||
    haystack.includes("voided check") ||
    haystack.includes("voided business check")
  ) {
    return "business_documents";
  }

  return "supporting_documents";
}

// ---------------------------------------------------------------------------
// Document guidance map (15+ types)
// ---------------------------------------------------------------------------

const DOCUMENT_GUIDANCE_MAP: ReadonlyArray<{
  keywords: string[];
  guidance: BorrowerDocumentGuidance;
}> = [
  {
    keywords: ["business tax return", "1120", "1065", "business return"],
    guidance: {
      label: "Business tax returns",
      whyItMatters:
        "Tax returns are the primary evidence of business income and are required for nearly every SBA package.",
      helpfulUploadHint:
        "Upload the complete signed federal return, including all schedules. A complete PDF from your accountant works best.",
      commonIssueToAvoid:
        "Avoid uploading only the first page or a state-only return. Partial returns usually require a follow-up upload.",
      acceptedFormatsCopy: "PDF is best. Multi-page scans are fine.",
    },
  },
  {
    keywords: ["personal tax return", "1040", "personal return"],
    guidance: {
      label: "Personal tax returns",
      whyItMatters:
        "Personal returns help reviewers evaluate guarantor income and personal financial capacity.",
      helpfulUploadHint:
        "Include the full filed return with all schedules, W-2s, and 1099s for each requested year.",
      commonIssueToAvoid:
        "Missing W-2s, 1099s, or schedules often require a re-upload.",
      acceptedFormatsCopy: "PDF is best. A clean scan also works.",
    },
  },
  {
    keywords: ["ytd profit", "year to date p&l", "ytd p&l", "ytd profit & loss"],
    guidance: {
      label: "Year-to-date Profit & Loss",
      whyItMatters:
        "A current P&L shows how the business is performing right now, not just historically.",
      helpfulUploadHint:
        "Export the most recent YTD P&L from your accounting software with month-by-month detail when possible.",
      acceptedFormatsCopy: "PDF or Excel both work.",
    },
  },
  {
    keywords: ["profit", "p&l", "p & l", "income statement"],
    guidance: {
      label: "Profit & Loss statement",
      whyItMatters:
        "A current P&L helps Buddy prepare a view of recent business performance.",
      helpfulUploadHint:
        "Year-to-date P&L from your accounting software is ideal. Include month-by-month detail if possible.",
      acceptedFormatsCopy: "PDF or Excel both work.",
    },
  },
  {
    keywords: ["balance sheet"],
    guidance: {
      label: "Balance sheet",
      whyItMatters:
        "Reviewers use this to assess liquidity, leverage, and overall financial health.",
      helpfulUploadHint:
        "Provide the most recent balance sheet from your accounting system.",
      acceptedFormatsCopy: "PDF or Excel both work.",
    },
  },
  {
    keywords: ["debt schedule"],
    guidance: {
      label: "Current business debt schedule",
      whyItMatters:
        "A clear debt picture helps demonstrate how a new loan fits within existing capacity.",
      helpfulUploadHint:
        "List each obligation with lender, balance, monthly payment, maturity, and collateral.",
      commonIssueToAvoid:
        "Omitting small loans or credit lines can create discrepancies during review.",
      acceptedFormatsCopy: "PDF or spreadsheet both work.",
    },
  },
  {
    keywords: ["bank statement"],
    guidance: {
      label: "Business bank statements",
      whyItMatters:
        "Bank statements verify cash flow, deposits, and operating patterns.",
      helpfulUploadHint:
        "Provide the most recent 3 months of statements for each business operating account.",
      commonIssueToAvoid:
        "Make sure each page is included. Statements with missing pages may need re-upload.",
      acceptedFormatsCopy: "PDF is best. Clear scans are fine.",
    },
  },
  {
    keywords: ["sba form 1919", "1919"],
    guidance: {
      label: "SBA Form 1919",
      whyItMatters:
        "SBA requires this form as part of the authorization package before submission.",
      helpfulUploadHint:
        "Complete every section. Each owner with 20% or more ownership submits one.",
      commonIssueToAvoid:
        "Blank fields are often flagged for follow-up. Entering zero is better than leaving a field empty.",
      acceptedFormatsCopy: "Signed PDF preferred.",
    },
  },
  {
    keywords: ["sba form 413", "413", "personal financial statement", "pfs"],
    guidance: {
      label: "Personal Financial Statement (SBA Form 413)",
      whyItMatters:
        "Lenders use this to evaluate guarantor capacity and global cash flow.",
      helpfulUploadHint:
        "Use the SBA form or your bank's template. Ensure all fields are filled and the form is signed.",
      commonIssueToAvoid:
        "Blank fields are often flagged. Entering zero is better than leaving a field empty.",
      acceptedFormatsCopy: "Signed PDF preferred.",
    },
  },
  {
    keywords: ["driver", "driver's license", "drivers license", "government id", "passport"],
    guidance: {
      label: "Government-issued ID",
      whyItMatters:
        "Lenders verify the identity of each guarantor as part of standard SBA review.",
      helpfulUploadHint:
        "A clear photo of the front of your driver's license, state ID, or passport works.",
      commonIssueToAvoid:
        "Make sure the photo is sharp and all four edges of the ID are visible.",
      acceptedFormatsCopy: "PDF, PNG, or JPG.",
    },
  },
  {
    keywords: ["entity", "operating agreement", "articles of incorporation", "formation", "bylaws", "partnership agreement"],
    guidance: {
      label: "Entity formation documents",
      whyItMatters:
        "Lenders verify ownership structure and entity type as part of SBA eligibility.",
      helpfulUploadHint:
        "Include articles of incorporation plus the current operating or partnership agreement.",
      acceptedFormatsCopy: "PDF preferred.",
    },
  },
  {
    keywords: ["lease"],
    guidance: {
      label: "Current lease agreement",
      whyItMatters:
        "Lease obligations factor into cash flow analysis and debt capacity.",
      helpfulUploadHint:
        "Provide the full executed lease including amendments. Ensure rent amount and term are visible.",
      acceptedFormatsCopy: "PDF preferred.",
    },
  },
  {
    keywords: ["purchase agreement", "letter of intent", "loi"],
    guidance: {
      label: "Purchase agreement or letter of intent",
      whyItMatters:
        "Required for SBA loans that involve a business acquisition or change of ownership.",
      helpfulUploadHint:
        "Provide the signed agreement or LOI with purchase price, terms, and closing conditions.",
      acceptedFormatsCopy: "Signed PDF preferred.",
    },
  },
  {
    keywords: ["franchise"],
    guidance: {
      label: "Franchise agreement",
      whyItMatters:
        "Franchise terms shape the business model reviewers use to evaluate cash flow.",
      helpfulUploadHint:
        "Upload the signed franchise agreement, including all exhibits and schedules.",
      acceptedFormatsCopy: "PDF preferred.",
    },
  },
  {
    keywords: ["payroll"],
    guidance: {
      label: "Payroll reports",
      whyItMatters:
        "Payroll detail helps Buddy reconcile wage expense and headcount in the financials.",
      helpfulUploadHint:
        "Provide the most recent payroll summary or quarterly 941 filings.",
      acceptedFormatsCopy: "PDF or spreadsheet both work.",
    },
  },
  {
    keywords: ["insurance"],
    guidance: {
      label: "Insurance documents",
      whyItMatters:
        "SBA lenders verify required business insurance coverage before closing.",
      helpfulUploadHint:
        "Provide a current certificate of insurance or the active policy declarations page.",
      acceptedFormatsCopy: "PDF preferred.",
    },
  },
];

const DEFAULT_GUIDANCE: BorrowerDocumentGuidance = {
  label: "Requested document",
  whyItMatters:
    "Buddy needs this document to complete the SBA package and reduce follow-up questions during review.",
  helpfulUploadHint:
    "Upload the most recent, complete version of this document. Clear scans and phone photos are okay if every page is readable.",
  acceptedFormatsCopy: "PDF is best. Clear scans and common office documents also work.",
};

function lookupGuidance(title: string): BorrowerDocumentGuidance {
  const lower = title.toLowerCase();
  for (const entry of DOCUMENT_GUIDANCE_MAP) {
    for (const keyword of entry.keywords) {
      if (lower.includes(keyword)) {
        return entry.guidance;
      }
    }
  }
  return { ...DEFAULT_GUIDANCE, label: title };
}

// ---------------------------------------------------------------------------
// Status copy helpers
// ---------------------------------------------------------------------------

function statusLabel(status: BorrowerDocumentStatus): string {
  switch (status) {
    case "missing":
      return "Needed";
    case "uploaded":
      return "Uploaded";
    case "received":
      return "Received";
    case "reviewing":
      return "Being reviewed";
    case "accepted":
      return "Looks good";
    case "needs_attention":
      return "Needs attention";
    case "optional":
      return "Optional";
    case "unavailable":
      return "Not yet available";
  }
}

function reassuranceFor(
  status: BorrowerDocumentStatus,
): string | undefined {
  switch (status) {
    case "uploaded":
      return "Upload received. Buddy is preparing it for review.";
    case "received":
      return "Buddy received this document. You do not need to upload it again unless Buddy asks.";
    case "reviewing":
      return "This item is saved to your package and is being reviewed.";
    case "accepted":
      return "This item is saved to your package. Buddy will surface any follow-up needed here.";
    default:
      return undefined;
  }
}

function recoveryFor(status: BorrowerDocumentStatus): string | undefined {
  if (status === "needs_attention") {
    return "This document may need a clearer copy or all pages included. Please upload the complete version when available.";
  }
  return undefined;
}

function ctaFor(
  status: BorrowerDocumentStatus,
  uploadCount: number,
): string | undefined {
  if (status === "accepted") return undefined;
  if (status === "reviewing" || status === "received") {
    return uploadCount > 0 ? "Upload updated version" : undefined;
  }
  if (status === "needs_attention") return "Upload a clearer version";
  if (status === "uploaded") return "Upload updated version";
  if (status === "missing") return "Upload document";
  if (status === "optional") return "Upload when ready";
  if (status === "unavailable") return undefined;
  return "Upload document";
}

// ---------------------------------------------------------------------------
// Requirement builder
// ---------------------------------------------------------------------------

function buildRequirement(
  input: BorrowerDocumentItemInput,
  token: string,
): BorrowerDocumentRequirement {
  const guidance = lookupGuidance(input.title);
  const status = input.status;
  const uploadCount = input.uploadCount ?? 0;
  const cta = ctaFor(status, uploadCount);
  const href = cta ? `/upload/${token}` : undefined;
  const groupId = classifyGroup(input.title, input.group);

  return {
    id: input.id,
    groupId,
    label: guidance.label !== DEFAULT_GUIDANCE.label ? guidance.label : input.title,
    status,
    statusLabel: statusLabel(status),
    required: input.required,
    guidance,
    ctaLabel: cta,
    href,
    latestUploadedAt: input.latestUploadedAt ?? undefined,
    uploadCount: uploadCount > 0 ? uploadCount : undefined,
    reassurance: reassuranceFor(status),
    recoveryMessage: recoveryFor(status),
  };
}

// ---------------------------------------------------------------------------
// Sorting helpers (deterministic)
// ---------------------------------------------------------------------------

function statusSortRank(status: BorrowerDocumentStatus): number {
  switch (status) {
    case "needs_attention":
      return 0;
    case "missing":
      return 1;
    case "uploaded":
      return 2;
    case "received":
      return 3;
    case "reviewing":
      return 4;
    case "accepted":
      return 5;
    case "optional":
      return 6;
    case "unavailable":
      return 7;
  }
}

function sortRequirements(
  a: BorrowerDocumentRequirement,
  b: BorrowerDocumentRequirement,
): number {
  // Required first
  if (a.required !== b.required) return a.required ? -1 : 1;
  // Then by status rank
  const sa = statusSortRank(a.status);
  const sb = statusSortRank(b.status);
  if (sa !== sb) return sa - sb;
  // Then alphabetical by label for stable ordering
  return a.label.localeCompare(b.label);
}

// ---------------------------------------------------------------------------
// Package summary builder
// ---------------------------------------------------------------------------

const RECEIVED_STATUSES: ReadonlySet<BorrowerDocumentStatus> = new Set([
  "uploaded",
  "received",
  "reviewing",
  "accepted",
]);

function buildPackageSummary(
  requirements: BorrowerDocumentRequirement[],
): BorrowerDocumentPackageSummary {
  let requiredTotal = 0;
  let requiredReceived = 0;
  let optionalReceived = 0;
  let needsAttention = 0;

  for (const r of requirements) {
    const isReceived = RECEIVED_STATUSES.has(r.status);
    if (r.required) {
      requiredTotal += 1;
      if (isReceived) requiredReceived += 1;
    } else if (isReceived) {
      optionalReceived += 1;
    }
    if (r.status === "needs_attention") needsAttention += 1;
  }

  const requiredRemaining = Math.max(0, requiredTotal - requiredReceived);

  const summaryParts: string[] = [];
  if (requiredTotal > 0) {
    summaryParts.push(
      `${requiredReceived} of ${requiredTotal} required item${requiredTotal === 1 ? "" : "s"} received`,
    );
  }
  if (requiredRemaining > 0) {
    summaryParts.push(
      `${requiredRemaining} item${requiredRemaining === 1 ? "" : "s"} still needed`,
    );
  }
  if (needsAttention > 0) {
    summaryParts.push(
      `${needsAttention} item${needsAttention === 1 ? "" : "s"} needs attention`,
    );
  }

  const summary =
    summaryParts.length > 0
      ? summaryParts.join(" · ")
      : "Buddy will list requested items here as soon as they are ready.";

  return {
    requiredTotal,
    requiredReceived,
    requiredRemaining,
    optionalReceived,
    needsAttention,
    summary,
  };
}

// ---------------------------------------------------------------------------
// Group builder
// ---------------------------------------------------------------------------

function buildGroups(
  requirements: BorrowerDocumentRequirement[],
): BorrowerDocumentGroup[] {
  const buckets = new Map<BorrowerDocumentGroupId, BorrowerDocumentRequirement[]>();

  for (const r of requirements) {
    const list = buckets.get(r.groupId) ?? [];
    list.push(r);
    buckets.set(r.groupId, list);
  }

  const groups: BorrowerDocumentGroup[] = [];
  for (const groupId of GROUP_ORDER) {
    const items = buckets.get(groupId);
    if (!items || items.length === 0) continue;

    const sorted = [...items].sort(sortRequirements);
    let requiredCount = 0;
    let receivedCount = 0;
    let needsAttentionCount = 0;
    for (const r of sorted) {
      if (r.required) requiredCount += 1;
      if (RECEIVED_STATUSES.has(r.status)) receivedCount += 1;
      if (r.status === "needs_attention") needsAttentionCount += 1;
    }

    const def = GROUP_DEFINITIONS[groupId];
    groups.push({
      id: def.id,
      label: def.label,
      description: def.description,
      requiredCount,
      receivedCount,
      needsAttentionCount,
      requirements: sorted,
    });
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Primary attention items
// ---------------------------------------------------------------------------

function attentionRank(r: BorrowerDocumentRequirement): number {
  if (r.status === "needs_attention") return 0;
  if (r.required && r.status === "missing") return 1;
  if (r.required && r.status === "uploaded") return 2;
  if (!r.required && r.status === "missing") return 3;
  return 99;
}

function buildPrimaryAttention(
  requirements: BorrowerDocumentRequirement[],
  cap: number,
): BorrowerDocumentRequirement[] {
  const candidates = requirements
    .filter((r) => attentionRank(r) < 99)
    .sort((a, b) => {
      const ra = attentionRank(a);
      const rb = attentionRank(b);
      if (ra !== rb) return ra - rb;
      return a.label.localeCompare(b.label);
    });
  return candidates.slice(0, Math.max(0, cap));
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

export function buildBorrowerDocumentExperienceViewModel(
  input: DocumentExperienceInput,
): BorrowerDocumentExperienceViewModel {
  const cap = input.maxPrimaryAttention ?? 3;

  const requirements = input.items.map((item) =>
    buildRequirement(item, input.token),
  );

  const groups = buildGroups(requirements);
  const packageSummary = buildPackageSummary(requirements);
  const primaryAttentionItems = buildPrimaryAttention(requirements, cap);

  return {
    packageSummary,
    groups,
    primaryAttentionItems,
  };
}
