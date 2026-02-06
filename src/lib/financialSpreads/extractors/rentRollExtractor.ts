import "server-only";

import {
  callClaudeForExtraction,
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

export async function extractRentRoll(args: {
  dealId: string;
  bankId: string;
  documentId: string;
  ocrText: string;
}): Promise<ExtractionResult> {
  if (!args.ocrText.trim()) {
    return { ok: true, factsWritten: 0 };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = await callClaudeForExtraction({
      systemPrompt: SYSTEM_PROMPT,
      ocrText: args.ocrText,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[rentRollExtractor] Claude call failed:", msg);
    return { ok: false, factsWritten: 0, error: msg };
  }

  const rawRows = Array.isArray(parsed.rows) ? parsed.rows : [];
  if (!rawRows.length) {
    return { ok: true, factsWritten: 0 };
  }

  // Derive as_of_date from AI response or use a reasonable default
  const asOfDate = typeof parsed.as_of_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.as_of_date)
    ? parsed.as_of_date
    : new Date().toISOString().slice(0, 10);

  const rows: ExtractedRentRollRow[] = [];

  for (const raw of rawRows) {
    const unitId = String(raw.unit_id ?? "").trim();
    if (!unitId) continue;

    const status = String(raw.occupancy_status ?? "").toUpperCase();
    const occupancy: "OCCUPIED" | "VACANT" = status === "VACANT" ? "VACANT" : "OCCUPIED";

    rows.push({
      unit_id: unitId,
      tenant_name: raw.tenant_name ? String(raw.tenant_name) : null,
      occupancy_status: occupancy,
      unit_type: raw.unit_type ? String(raw.unit_type) : null,
      sqft: typeof raw.sqft === "number" && Number.isFinite(raw.sqft) ? raw.sqft : null,
      monthly_rent: typeof raw.monthly_rent === "number" && Number.isFinite(raw.monthly_rent) ? raw.monthly_rent : null,
      annual_rent: typeof raw.annual_rent === "number" && Number.isFinite(raw.annual_rent) ? raw.annual_rent : null,
      market_rent_monthly: typeof raw.market_rent_monthly === "number" && Number.isFinite(raw.market_rent_monthly) ? raw.market_rent_monthly : null,
      lease_start: typeof raw.lease_start === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.lease_start) ? raw.lease_start : null,
      lease_end: typeof raw.lease_end === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.lease_end) ? raw.lease_end : null,
      concessions_monthly: typeof raw.concessions_monthly === "number" && Number.isFinite(raw.concessions_monthly) ? raw.concessions_monthly : null,
      notes: raw.notes ? String(raw.notes) : null,
    });
  }

  if (!rows.length) {
    return { ok: true, factsWritten: 0 };
  }

  return writeRentRollRows({
    dealId: args.dealId,
    bankId: args.bankId,
    sourceDocumentId: args.documentId,
    asOfDate,
    rows,
  });
}
