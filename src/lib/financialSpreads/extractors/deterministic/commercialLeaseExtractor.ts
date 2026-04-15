import "server-only";
import { upsertDealFinancialFact } from "@/lib/financialFacts/writeFact";

/**
 * Commercial Lease Extractor (Deterministic)
 *
 * Extracts structured facts from commercial lease agreements, NNN leases,
 * and lease amendments. Writes to deal_financial_facts with factType=COMMERCIAL_LEASE.
 *
 * Key facts extracted:
 *   LEASE_TENANT_NAME          — name of the tenant entity
 *   LEASE_LANDLORD_NAME        — name of the landlord entity
 *   LEASE_COMMENCEMENT_DATE    — lease start date (ISO string)
 *   LEASE_EXPIRATION_DATE      — lease end date (ISO string)
 *   LEASE_TERM_MONTHS          — term in months
 *   LEASE_MONTHLY_RENT_CURRENT — current monthly rent ($)
 *   LEASE_ANNUAL_RENT_CURRENT  — current annual rent ($)
 *   LEASE_TYPE                 — "NNN" | "GROSS" | "MODIFIED_GROSS" | "UNKNOWN"
 *   LEASE_PREMISES_ADDRESS     — collateral/premises address
 *   LEASE_RENT_STEP_1_PERIOD   — text description of step period 1
 *   LEASE_RENT_STEP_1_MONTHLY  — monthly rent for step 1
 *   LEASE_RENT_STEP_2_PERIOD   — text description of step period 2
 *   LEASE_RENT_STEP_2_MONTHLY  — monthly rent for step 2
 *   LEASE_RENT_STEP_3_PERIOD   — text description of step period 3
 *   LEASE_RENT_STEP_3_MONTHLY  — monthly rent for step 3
 *   LEASE_RENT_STEP_4_PERIOD   — text description of step period 4
 *   LEASE_RENT_STEP_4_MONTHLY  — monthly rent for step 4
 *
 * SBA / Investment Property flags (written as factValueText):
 *   LEASE_SBA504_ELIGIBLE      — "false" when tenant ≠ borrower (third-party lease)
 *   LEASE_OCCUPANCY_TYPE       — "OWNER_OCCUPIED" | "INVESTMENT_PROPERTY"
 */

interface ExtractArgs {
  dealId: string;
  bankId: string;
  documentId: string;
  ocrText: string;
}

interface ExtractResult {
  factsWritten: number;
  extractionPath: string;
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

function parseMoneyStr(raw: string): number | null {
  const clean = raw.replace(/[,$\s]/g, "");
  const n = parseFloat(clean);
  return isNaN(n) ? null : n;
}

/**
 * Extract tenant name from lease OCR text.
 * Tries several patterns common to commercial leases.
 */
function extractTenantName(text: string): string | null {
  const patterns = [
    // "Road Star Driving CS ("Tenant")"
    /([A-Z][A-Za-z0-9\s,\.]+?)\s+\("Tenant"\)/,
    // Tenant: Road Star Driving CS
    /[Tt]enant[:\s]+([A-Z][A-Za-z0-9\s,\.]{2,60})/,
    // "and Road Star Driving CS (\"Tenant\")"
    /and\s+([A-Z][A-Za-z0-9\s,\.]{2,60})\s+\("Tenant"\)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return null;
}

/**
 * Extract landlord name from lease OCR text.
 */
function extractLandlordName(text: string): string | null {
  const patterns = [
    /([A-Z][A-Za-z0-9\s,\.]+?)\s+\("Landlord"\)/,
    /[Ll]andlord[:\s]+([A-Z][A-Za-z0-9\s,\.]{2,60})/,
    /between\s+([A-Z][A-Za-z0-9\s,\.]{2,60})\s+\("Landlord"\)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return null;
}

/**
 * Extract premises/property address from lease text.
 */
function extractPremisesAddress(text: string): string | null {
  const patterns = [
    // "Suite 100 ... 3740 Dacoro Lane..."
    /(?:premises|located\s+at|property\s+at)\s+[:\s]*([0-9]+[A-Za-z0-9\s,\.#]+(?:Lane|Drive|Street|Ave|Blvd|Road|Rd|Dr|Ln|St|Ct|Way|Pl)[^,\n]*(?:,\s*[A-Za-z\s]+,?\s*[A-Z]{2}\s*\d{5})?)/i,
    /(\d{3,5}\s+[A-Za-z0-9\s]+(?:Lane|Drive|Street|Ave|Blvd|Road|Rd|Dr|Ln|St|Ct|Way|Pl)[^,\n]*(?:,\s*[A-Za-z\s]+,?\s*[A-Z]{2}\s*\d{5})?)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return null;
}

/**
 * Detect lease type: NNN, Gross, or Modified Gross.
 */
function detectLeaseType(text: string): string {
  if (/\bNNN\b|triple\s+net|net\s+net\s+net/i.test(text)) return "NNN";
  if (/\bgross\s+lease\b/i.test(text)) return "GROSS";
  if (/modified\s+gross/i.test(text)) return "MODIFIED_GROSS";
  if (/plus\s+utilities/i.test(text)) return "NNN"; // "plus utilities" is a NNN signal
  return "UNKNOWN";
}

/**
 * Parse commencement and expiration dates from lease term language.
 * Handles "commencing on August 1st, 2024 and ending on July 31st, 2028"
 */
function parseLeaseDates(text: string): { commencement: string | null; expiration: string | null; termMonths: number | null } {
  const monthNames: Record<string, number> = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  };

  // "commencing on August 1st, 2024 and ending on July 31st, 2028"
  const rangePattern = /commenc(?:ing|ement)\s+(?:on\s+)?([A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?,?\s*\d{4}).*?end(?:ing|s)\s+(?:on\s+)?([A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?,?\s*\d{4})/i;
  const rangeMatch = text.match(rangePattern);

  function parseDateStr(raw: string): string | null {
    const clean = raw.replace(/(?:st|nd|rd|th)/g, "").replace(/,/g, "").trim();
    const parts = clean.split(/\s+/);
    if (parts.length < 3) return null;
    const [mon, day, yr] = parts;
    const monthNum = monthNames[mon.toLowerCase()];
    if (!monthNum) return null;
    const mm = String(monthNum).padStart(2, "0");
    const dd = String(parseInt(day)).padStart(2, "0");
    return `${yr}-${mm}-${dd}`;
  }

  if (rangeMatch) {
    const commencement = parseDateStr(rangeMatch[1]);
    const expiration = parseDateStr(rangeMatch[2]);
    let termMonths: number | null = null;
    if (commencement && expiration) {
      const start = new Date(commencement);
      const end = new Date(expiration);
      termMonths = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 30.44));
    }
    return { commencement, expiration, termMonths };
  }

  // "Forty-Eight (48) months commencing on August 1st, 2024"
  const termPattern = /(?:for\s+)?(?:[A-Za-z\-]+\s+\()?(\d+)\)?\s+months?\s+commenc(?:ing|ement)\s+(?:on\s+)?([A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?,?\s*\d{4})/i;
  const termMatch = text.match(termPattern);
  if (termMatch) {
    const termMonths = parseInt(termMatch[1]);
    const commencement = parseDateStr(termMatch[2]);
    let expiration: string | null = null;
    if (commencement && !isNaN(termMonths)) {
      const start = new Date(commencement);
      start.setMonth(start.getMonth() + termMonths);
      start.setDate(start.getDate() - 1);
      expiration = start.toISOString().substring(0, 10);
    }
    return { commencement, expiration, termMonths };
  }

  return { commencement: null, expiration: null, termMonths: null };
}

/**
 * Parse rent step schedule from lease text.
 * Returns up to 4 steps: { period, monthly, annual }
 */
interface RentStep {
  period: string;
  monthly: number;
  annual: number;
}

function parseRentSchedule(text: string): RentStep[] {
  const steps: RentStep[] = [];

  // Pattern: date range + monthly amount (with optional "/plus utilities")
  // "8/1/2024 – 7/31/2025 $3,735.42/plus utilities $44,825.00/plus utilities"
  const tablePattern = /(\d{1,2}\/\d{1,2}\/\d{2,4})\s*[–\-—]+\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\s+\$([\d,]+\.?\d*)\s*\/?\s*(?:plus\s+utilities\s+)?\$([\d,]+\.?\d*)/gi;
  let match: RegExpExecArray | null;
  while ((match = tablePattern.exec(text)) !== null && steps.length < 4) {
    const monthly = parseMoneyStr(match[3]);
    const annual = parseMoneyStr(match[4]);
    if (monthly !== null && annual !== null) {
      steps.push({ period: `${match[1]} – ${match[2]}`, monthly, annual });
    }
  }

  // Fallback: single monthly rent line "Monthly Rent: $3,884.83"
  if (steps.length === 0) {
    const singlePattern = /(?:monthly\s+rent|rent)[:\s]+\$([\d,]+\.?\d*)/i;
    const sm = text.match(singlePattern);
    if (sm) {
      const monthly = parseMoneyStr(sm[1]);
      if (monthly !== null) {
        steps.push({ period: "current", monthly, annual: monthly * 12 });
      }
    }
  }

  return steps;
}

// ---------------------------------------------------------------------------
// Main extractor
// ---------------------------------------------------------------------------

export async function extractCommercialLeaseDeterministic(
  args: ExtractArgs,
): Promise<ExtractResult> {
  const { dealId, bankId, documentId, ocrText } = args;
  let factsWritten = 0;

  const writes: Promise<{ ok: boolean }>[] = [];

  const writeFact = (
    factKey: string,
    factValueNum: number | null,
    factValueText?: string | null,
    confidence = 0.85,
  ) => {
    writes.push(
      upsertDealFinancialFact({
        dealId,
        bankId,
        sourceDocumentId: documentId,
        factType: "COMMERCIAL_LEASE",
        factKey,
        factValueNum,
        factValueText: factValueText ?? null,
        confidence,
        provenance: {
          source_type: "DOC_EXTRACT",
          source_ref: `deal_documents:${documentId}`,
          as_of_date: null,
          extractor: "commercialLeaseExtractor:v1:deterministic",
        },
      }),
    );
  };

  // --- Party names ---
  const tenantName = extractTenantName(ocrText);
  const landlordName = extractLandlordName(ocrText);
  if (tenantName) writeFact("LEASE_TENANT_NAME", null, tenantName, 0.88);
  if (landlordName) writeFact("LEASE_LANDLORD_NAME", null, landlordName, 0.88);

  // --- Premises address ---
  const premises = extractPremisesAddress(ocrText);
  if (premises) writeFact("LEASE_PREMISES_ADDRESS", null, premises, 0.82);

  // --- Lease type (NNN / Gross / Modified Gross) ---
  const leaseType = detectLeaseType(ocrText);
  writeFact("LEASE_TYPE", null, leaseType, leaseType === "UNKNOWN" ? 0.5 : 0.9);

  // --- Dates and term ---
  const { commencement, expiration, termMonths } = parseLeaseDates(ocrText);
  if (commencement) writeFact("LEASE_COMMENCEMENT_DATE", null, commencement, 0.87);
  if (expiration) writeFact("LEASE_EXPIRATION_DATE", null, expiration, 0.87);
  if (termMonths !== null) writeFact("LEASE_TERM_MONTHS", termMonths, null, 0.87);

  // --- Rent schedule ---
  const steps = parseRentSchedule(ocrText);
  if (steps.length > 0) {
    // Current (first step) is the primary fact
    writeFact("LEASE_MONTHLY_RENT_CURRENT", steps[0].monthly, null, 0.88);
    writeFact("LEASE_ANNUAL_RENT_CURRENT", steps[0].annual, null, 0.88);
    // Write step details (up to 4)
    for (let i = 0; i < Math.min(steps.length, 4); i++) {
      const n = i + 1;
      writeFact(`LEASE_RENT_STEP_${n}_PERIOD`, null, steps[i].period, 0.86);
      writeFact(`LEASE_RENT_STEP_${n}_MONTHLY`, steps[i].monthly, null, 0.86);
    }
  }

  // --- Occupancy type / SBA 504 eligibility flag ---
  // If tenant is different from the borrower entity, this is an investment property.
  // We write the flag here; the spread engine reads it to switch DSCR mode.
  // Note: we can't resolve borrower name here, so we write the tenant name as context.
  // The SBA flag is set speculatively — analyst can override via canonical_type.
  if (tenantName) {
    // Third-party tenanted property → investment property → SBA 504 ineligible
    writeFact("LEASE_OCCUPANCY_TYPE", null, "INVESTMENT_PROPERTY", 0.8);
    writeFact("LEASE_SBA504_ELIGIBLE", null, "false", 0.8);
  }

  // Execute all writes
  const results = await Promise.all(writes);
  for (const r of results) {
    if (r.ok) factsWritten += 1;
  }

  return { factsWritten, extractionPath: "commercial_lease_deterministic:v1" };
}
