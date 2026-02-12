import "server-only";

import {
  writeRentRollRows,
  type ExtractedRentRollRow,
  type ExtractionResult,
} from "./shared";

// ---------------------------------------------------------------------------
// Extraction prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a rent roll extraction expert for commercial real estate lending.

Given a rent roll document, extract EVERY unit/tenant row you can identify.

For EACH row, provide:
- "unit_id": Unit/suite number (e.g. "101", "A-202", "Suite 300"). REQUIRED.
- "tenant_name": Tenant name, or null if vacant
- "occupancy_status": "OCCUPIED" or "VACANT"
- "unit_type": Unit type if shown (e.g. "1BR/1BA", "Office", "Retail", "2BR")
- "sqft": Square footage as a number, or null
- "monthly_rent": Monthly rent as a number, or null
- "annual_rent": Annual rent as a number, or null
- "market_rent_monthly": Market rent per month if shown, or null
- "lease_start": Lease start date as "YYYY-MM-DD", or null
- "lease_end": Lease end date as "YYYY-MM-DD", or null
- "concessions_monthly": Monthly concessions amount, or null
- "notes": Any relevant notes for this unit

Also provide:
- "as_of_date": The date the rent roll is effective (e.g. "2024-01-01"). Use the most prominent date on the document, or estimate from context.
- "property_name": Property name if shown, or null
- "total_units": Total unit count if shown, or null

Respond with JSON:
{
  "as_of_date": "2024-01-01",
  "property_name": "Sunset Apartments",
  "total_units": 24,
  "rows": [
    {
      "unit_id": "101",
      "tenant_name": "John Smith",
      "occupancy_status": "OCCUPIED",
      "unit_type": "1BR/1BA",
      "sqft": 750,
      "monthly_rent": 1250,
      "annual_rent": 15000,
      "market_rent_monthly": 1300,
      "lease_start": "2023-06-01",
      "lease_end": "2024-05-31",
      "concessions_monthly": null,
      "notes": null
    }
  ]
}

Rules:
- Extract EVERY unit, including vacant ones
- Vacant units should have occupancy_status "VACANT" and tenant_name null
- If only monthly rent is shown, leave annual_rent null (system derives it)
- If only annual rent is shown, leave monthly_rent null
- Use YYYY-MM-DD format for all dates
- If no as_of_date is visible, use today's date or the most recent date in the document`;

// ---------------------------------------------------------------------------
// Extractor
// ---------------------------------------------------------------------------

export async function extractRentRoll(_args: {
  dealId: string;
  bankId: string;
  documentId: string;
  ocrText: string;
}): Promise<ExtractionResult> {
  return { ok: false, factsWritten: 0, skipped: true, skipReason: "legacy_llm_extractor_disabled" };
}
