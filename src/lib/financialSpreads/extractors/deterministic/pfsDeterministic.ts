import "server-only";

import type { FinancialFactProvenance } from "@/lib/financialFacts/keys";
import {
  normalizePeriod,
  writeFactsBatch,
  type ExtractedLineItem,
  type ExtractionResult,
} from "../shared";
import type { DeterministicExtractorArgs, ExtractionPath } from "./types";
import { findLabeledAmount, resolveDocDate } from "./parseUtils";
import {
  extractEntitiesFlat,
  entityToMoney,
} from "./structuredJsonParser";
import { upsertDealFinancialFact } from "@/lib/financialFacts/writeFact";

// ---------------------------------------------------------------------------
// Canonical line item keys (same as original extractor)
// ---------------------------------------------------------------------------

const VALID_LINE_KEYS = new Set([
  "PFS_CASH", "PFS_SECURITIES", "PFS_REAL_ESTATE", "PFS_BUSINESS_INTERESTS",
  "PFS_RETIREMENT", "PFS_OTHER_ASSETS", "PFS_TOTAL_ASSETS",
  "PFS_MORTGAGES", "PFS_INSTALLMENT_DEBT", "PFS_CREDIT_CARDS",
  "PFS_CONTINGENT", "PFS_OTHER_LIABILITIES", "PFS_TOTAL_LIABILITIES",
  "PFS_NET_WORTH",
  "PFS_ANNUAL_DEBT_SERVICE", "PFS_LIVING_EXPENSES",
  "PFS_MORTGAGE_PAYMENT_MO",
  // Phase 82: Joint PFS detection keys (string-valued)
  "PFS_IS_JOINT", "PFS_CO_APPLICANT_NAME",
]);

// ---------------------------------------------------------------------------
// OCR regex patterns — defensive, multi-label search
// PFS documents vary wildly (SBA 413 vs bank-specific forms)
// ---------------------------------------------------------------------------

const LABEL_PATTERNS: Array<{ key: string; patterns: RegExp[] }> = [
  // Assets
  {
    key: "PFS_CASH",
    patterns: [
      /cash\s+(?:and\s+)?short[\s-]?term\s+invest/i,
      /cash\s+(?:in\s+)?banks?/i,
      /cash\s+(?:and\s+)?(?:cash\s+)?equivalents?/i,
      /checking\s+(?:and\s+)?savings/i,
      /deposits?\s+(?:in\s+)?(?:financial\s+)?institutions?/i,
      /liquid\s+assets?/i,
    ],
  },
  {
    key: "PFS_SECURITIES",
    patterns: [
      /stocks?\s*(?:&|and)\s*bonds?/i,
      /(?:other\s+)?marketable\s+securities/i,
      /stocks?,?\s+bonds?\s+(?:and\s+)?(?:other\s+)?securities/i,
      /brokerage\s+accounts?/i,
      /investment\s+accounts?/i,
    ],
  },
  {
    key: "PFS_REAL_ESTATE",
    patterns: [
      /real\s+estate[\s-]+(?:personal\s+)?residen/i,
      /real\s+estate[\s-]+invest/i,
      /real\s+estate\s+(?:owned|market\s+value)/i,
      /(?:market\s+)?value\s+of\s+(?:real\s+)?(?:estate|properties)/i,
      /property\s+values?/i,
    ],
  },
  {
    key: "PFS_BUSINESS_INTERESTS",
    patterns: [
      /business\s+(?:ownership|interests?|equity)/i,
      /(?:general|limited)\s+partnership\s+interests?/i,
      /partnership\s+(?:interests?|equity)/i,
      /LLC\s+(?:interests?|equity)/i,
    ],
  },
  {
    key: "PFS_RETIREMENT",
    patterns: [
      /retirement\s+(?:accounts?|funds?)/i,
      /401[\s(]?k\)?/i,
      /IRA|pension/i,
    ],
  },
  {
    key: "PFS_OTHER_ASSETS",
    patterns: [
      /other\s+assets?/i,
      /auto(?:mobile)?s?\s+(?:value|owned)?/i,
      /life\s+insurance\s+(?:cash\s+)?(?:surrender\s+)?value/i,
      /cash\s+surrender\s+value/i,
      /personal\s+property/i,
      /notes?\s+receivable/i,
    ],
  },
  {
    key: "PFS_TOTAL_ASSETS",
    patterns: [
      /total\s+assets/i,
    ],
  },
  // Liabilities
  {
    key: "PFS_MORTGAGES",
    patterns: [
      /mortgages?\s+(?:&|and)\s+obligations?\s+due/i,
      /mortgage(?:s)?\s+(?:payable|balance|owed|on\s+real\s+estate)/i,
      /(?:home|real\s+estate)\s+(?:loan|mortgage)\s+balance/i,
    ],
  },
  {
    key: "PFS_INSTALLMENT_DEBT",
    patterns: [
      /installment\s+(?:debt|loans?|accounts?)/i,
      /auto\s+loans?/i,
      /student\s+loans?/i,
      /notes?\s+(?:&|and)\s+accounts?\s+payable/i,
    ],
  },
  {
    key: "PFS_CREDIT_CARDS",
    patterns: [
      /(?:outstanding\s+)?credit\s+card\s+balance/i,
      /credit\s+card\s+(?:balance|debt)/i,
      /revolving\s+(?:debt|credit)/i,
    ],
  },
  {
    key: "PFS_CONTINGENT",
    patterns: [
      /contingent\s+(?:liabilit|obligation)/i,
      /co[\s-]?signed?\s+(?:loan|obligation)/i,
      /guarantee(?:s|d)?\s+(?:liabilit|obligation)/i,
    ],
  },
  {
    key: "PFS_OTHER_LIABILITIES",
    patterns: [
      /other\s+liabilit/i,
      /other\s+(?:debts?|obligations?)/i,
      /tax(?:es)?\s+(?:owed|payable)/i,
    ],
  },
  {
    key: "PFS_TOTAL_LIABILITIES",
    patterns: [
      /total\s+liabilit/i,
    ],
  },
  // Equity
  {
    key: "PFS_NET_WORTH",
    patterns: [
      /net\s+worth/i,
      /total\s+equity/i,
    ],
  },
  // Obligations
  {
    key: "PFS_ANNUAL_DEBT_SERVICE",
    patterns: [
      /annual\s+(?:debt\s+)?(?:service|payments?)/i,
      /total\s+(?:annual\s+)?(?:debt\s+)?(?:service|payments?)/i,
      /(?:monthly|annual)\s+(?:loan|debt)\s+payments?/i,
      /loan\s+payments?\s+(?:including|incl)/i,
    ],
  },
  {
    key: "PFS_MORTGAGE_PAYMENT_MO",
    patterns: [
      /monthly\s+(?:mortgage\s+)?(?:payment|pmt)/i,
      /(?:mortgage|re[12])\s+payment[s]?.*?(?:mo(?:nthly)?|\$)/i,
      /payment\s+(?:per\s+)?(?:month|mo\.?)/i,
    ],
  },
  {
    key: "PFS_LIVING_EXPENSES",
    patterns: [
      /(?:annual\s+)?living\s+(?:expenses?|costs?)/i,
      /general\s+living\s+(?:expenses?|costs?)/i,
      /(?:annual\s+)?household\s+(?:expenses?|costs?)/i,
      /personal\s+(?:expenses?|costs?|obligations?)/i,
      /total\s+expenses/i,
    ],
  },
];

// ---------------------------------------------------------------------------
// Structured entity type → canonical key mapping
// ---------------------------------------------------------------------------

const ENTITY_MAP: Record<string, string> = {
  cash: "PFS_CASH",
  cash_in_banks: "PFS_CASH",
  securities: "PFS_SECURITIES",
  stocks_bonds: "PFS_SECURITIES",
  real_estate: "PFS_REAL_ESTATE",
  real_estate_owned: "PFS_REAL_ESTATE",
  business_interests: "PFS_BUSINESS_INTERESTS",
  retirement: "PFS_RETIREMENT",
  retirement_accounts: "PFS_RETIREMENT",
  other_assets: "PFS_OTHER_ASSETS",
  total_assets: "PFS_TOTAL_ASSETS",
  mortgages: "PFS_MORTGAGES",
  mortgage_payable: "PFS_MORTGAGES",
  installment_debt: "PFS_INSTALLMENT_DEBT",
  credit_cards: "PFS_CREDIT_CARDS",
  contingent_liabilities: "PFS_CONTINGENT",
  other_liabilities: "PFS_OTHER_LIABILITIES",
  total_liabilities: "PFS_TOTAL_LIABILITIES",
  net_worth: "PFS_NET_WORTH",
};

// ---------------------------------------------------------------------------
// Extractor
// ---------------------------------------------------------------------------

export async function extractPfsDeterministic(
  args: DeterministicExtractorArgs,
): Promise<ExtractionResult & { extractionPath: ExtractionPath }> {
  if (!args.ocrText.trim() && !args.structuredJson) {
    return { ok: true, factsWritten: 0, extractionPath: "ocr_regex" };
  }

  let items: ExtractedLineItem[] = [];
  let path: ExtractionPath = "ocr_regex";

  if (args.structuredJson) {
    const structuredItems = tryStructuredEntities(args);
    if (structuredItems.length > 0) {
      items = structuredItems;
      path = "gemini_structured";
    }
  }

  if (items.length === 0 && args.ocrText.trim()) {
    items = tryOcrRegex(args);
    path = "ocr_regex";
  }

  if (items.length === 0) {
    return { ok: true, factsWritten: 0, extractionPath: path };
  }

  const result = await writeFactsBatch({
    dealId: args.dealId,
    bankId: args.bankId,
    sourceDocumentId: args.documentId,
    factType: "PERSONAL_FINANCIAL_STATEMENT",
    items,
    ownerType: "PERSONAL",
    ownerEntityId: args.ownerEntityId ?? null,
  });

  // SBA GCF requires annual personal debt service. PFS forms often only show
  // monthly mortgage payments. Derive annual from monthly when the annual
  // figure wasn't directly extracted.
  const hasAnnualDS = items.some((i) => i.factKey === "PFS_ANNUAL_DEBT_SERVICE");
  const monthlyPayment = items.find((i) => i.factKey === "PFS_MORTGAGE_PAYMENT_MO");
  if (!hasAnnualDS && monthlyPayment && monthlyPayment.value !== null && monthlyPayment.value > 0) {
    const annualDS = monthlyPayment.value * 12;
    await upsertDealFinancialFact({
      dealId: args.dealId,
      bankId: args.bankId,
      sourceDocumentId: args.documentId,
      factType: "PERSONAL_FINANCIAL_STATEMENT",
      factKey: "PFS_ANNUAL_DEBT_SERVICE",
      factValueNum: annualDS,
      confidence: 0.65,
      factPeriodStart: monthlyPayment.periodStart,
      factPeriodEnd: monthlyPayment.periodEnd,
      provenance: {
        source_type: "DOC_EXTRACT",
        source_ref: `deal_documents:${args.documentId}`,
        as_of_date: monthlyPayment.periodEnd,
        extractor: "pfsExtractor:v2:derived_annual_from_monthly",
        confidence: 0.65,
        extraction_path: path,
        citations: [
          {
            page: null,
            snippet: `Derived: PFS_MORTGAGE_PAYMENT_MO (${monthlyPayment.value}) × 12 = ${annualDS}`,
          },
        ],
        raw_snippets: [],
      } as FinancialFactProvenance,
      ownerType: "PERSONAL",
      ownerEntityId: args.ownerEntityId ?? null,
    });
  }

  // Phase 82: Detect joint PFS and write string facts
  await writeJointPfsStringFacts(args, path);

  return { ...result, extractionPath: path };
}

// ---------------------------------------------------------------------------
// Structured assist path
// ---------------------------------------------------------------------------

function tryStructuredEntities(args: DeterministicExtractorArgs): ExtractedLineItem[] {
  const entities = extractEntitiesFlat(args.structuredJson);
  if (entities.length === 0) return [];

  const items: ExtractedLineItem[] = [];
  const dateStr = resolveDocDate(args.ocrText, args.docYear);
  const { start: periodStart, end: periodEnd } = normalizePeriod(dateStr);

  for (const entity of entities) {
    const entityType = entity.type.toLowerCase().replace(/[\s-]+/g, "_");
    const canonicalKey = ENTITY_MAP[entityType];
    if (!canonicalKey || !VALID_LINE_KEYS.has(canonicalKey)) continue;

    const value = entityToMoney(entity);
    if (value === null) continue;

    const confidence = Math.min(1, Math.max(0, entity.confidence || 0.65));

    items.push({
      factKey: canonicalKey,
      value,
      confidence,
      periodStart,
      periodEnd,
      provenance: makeProvenance(args.documentId, periodEnd, confidence, entity.mentionText, "gemini_structured"),
    });
  }

  return items;
}

// ---------------------------------------------------------------------------
// OCR regex path — multi-label search (tries ALL patterns per key)
// ---------------------------------------------------------------------------

function tryOcrRegex(args: DeterministicExtractorArgs): ExtractedLineItem[] {
  const text = args.ocrText;
  const dateStr = resolveDocDate(text, args.docYear);
  const { start: periodStart, end: periodEnd } = normalizePeriod(dateStr);

  const items: ExtractedLineItem[] = [];

  for (const { key, patterns } of LABEL_PATTERNS) {
    let found = false;

    for (const pattern of patterns) {
      if (found) break;

      // Try same-line first, then cross-line fallback
      let result = findLabeledAmount(text, pattern);
      let confidence = key.startsWith("PFS_TOTAL") || key === "PFS_NET_WORTH" ? 0.50 : 0.45;
      if (result.value === null) {
        result = findLabeledAmount(text, pattern, { crossLine: true });
        confidence = Math.max(0.40, confidence - 0.05);
      }
      if (result.value === null) continue;

      items.push({
        factKey: key,
        value: result.value,
        confidence,
        periodStart,
        periodEnd,
        provenance: makeProvenance(args.documentId, periodEnd, confidence, result.snippet, "ocr_regex"),
      });
      found = true;
    }
  }

  return items;
}

// ---------------------------------------------------------------------------
// Phase 82: Joint PFS detection — string facts
// ---------------------------------------------------------------------------

function detectJointPfs(ocrText: string): { isJoint: boolean; coApplicantName: string | null } {
  const coApplicantPatterns = [
    /co[\s-]?applicant(?:'s)?\s+(?:name|signature)[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i,
    /joint\s+applicant[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i,
    /(?:and|&)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s*(?:\(spouse\)|co-?applicant)/i,
    // Two signature lines with names — look for second "Print Name:" or "Printed Name:"
    /print(?:ed)?\s+name[:\s]+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+[\s\S]{0,200}print(?:ed)?\s+name[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i,
  ];

  for (const pattern of coApplicantPatterns) {
    const match = ocrText.match(pattern);
    if (match?.[1]) {
      return { isJoint: true, coApplicantName: match[1].trim() };
    }
  }

  return { isJoint: false, coApplicantName: null };
}

async function writeJointPfsStringFacts(
  args: DeterministicExtractorArgs,
  path: ExtractionPath,
): Promise<void> {
  const { isJoint, coApplicantName } = detectJointPfs(args.ocrText);

  const dateStr = resolveDocDate(args.ocrText, args.docYear);
  const { start: periodStart, end: periodEnd } = normalizePeriod(dateStr);

  await upsertDealFinancialFact({
    dealId: args.dealId,
    bankId: args.bankId,
    sourceDocumentId: args.documentId,
    factType: "PERSONAL_FINANCIAL_STATEMENT",
    factKey: "PFS_IS_JOINT",
    factValueNum: null,
    factValueText: isJoint ? "true" : "false",
    confidence: isJoint ? 0.85 : 0.60,
    factPeriodStart: periodStart,
    factPeriodEnd: periodEnd,
    provenance: makeProvenance(args.documentId, periodEnd, isJoint ? 0.85 : 0.60, `pfs_is_joint=${isJoint}`, path),
    ownerType: "PERSONAL",
    ownerEntityId: args.ownerEntityId ?? null,
  });

  if (coApplicantName) {
    await upsertDealFinancialFact({
      dealId: args.dealId,
      bankId: args.bankId,
      sourceDocumentId: args.documentId,
      factType: "PERSONAL_FINANCIAL_STATEMENT",
      factKey: "PFS_CO_APPLICANT_NAME",
      factValueNum: null,
      factValueText: coApplicantName,
      confidence: 0.75,
      factPeriodStart: periodStart,
      factPeriodEnd: periodEnd,
      provenance: makeProvenance(args.documentId, periodEnd, 0.75, `co_applicant=${coApplicantName}`, path),
      ownerType: "PERSONAL",
      ownerEntityId: args.ownerEntityId ?? null,
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProvenance(
  documentId: string,
  periodEnd: string | null,
  confidence: number,
  snippet: string | null,
  path: ExtractionPath,
): FinancialFactProvenance {
  return {
    source_type: "DOC_EXTRACT",
    source_ref: `deal_documents:${documentId}`,
    as_of_date: periodEnd,
    extractor: "pfsExtractor:v2:deterministic",
    confidence,
    extraction_path: path,
    citations: snippet ? [{ page: null, snippet }] : [],
    raw_snippets: snippet ? [snippet] : [],
  } as FinancialFactProvenance;
}
