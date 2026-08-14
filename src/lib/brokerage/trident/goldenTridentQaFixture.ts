import "server-only";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { ingestDocument } from "@/lib/documents/ingestDocument";
import type { SupabaseClient } from "@supabase/supabase-js";

const FIXTURE_NAME = "[QA] Golden Trident v2 — Precision Fabrication";
const FIXTURE_VERSION = "golden-trident-qa-v2";

type FixtureResult = {
  dealId: string;
  created: boolean;
  fixtureVersion: string;
};

async function evidencePdf(title: string, lines: string[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([612, 792]);
  page.drawText(title, { x: 54, y: 730, size: 16, font: bold, color: rgb(0.12, 0.16, 0.22) });
  page.drawText("SYNTHETIC QA EVIDENCE — NOT A BORROWER DOCUMENT", {
    x: 54,
    y: 704,
    size: 9,
    font: bold,
    color: rgb(0.65, 0.2, 0.15),
  });
  let y = 670;
  for (const line of lines) {
    page.drawText(line, { x: 54, y, size: 10, font, color: rgb(0.18, 0.2, 0.24) });
    y -= 20;
  }
  return pdf.save();
}

async function requireOk(label: string, promise: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await promise;
  if (error) throw new Error(`${label}: ${error.message}`);
}

/**
 * Creates one idempotent, clearly-labelled test deal whose INPUTS exercise the
 * real Trident engines. Unlike goldenRun.ts, this function never inserts fake
 * succeeded bundles, package paths, spreads, feasibility studies, or memos.
 */
export async function seedGoldenTridentQaFixture(args: {
  sb: SupabaseClient;
  bankId: string;
}): Promise<FixtureResult> {
  const { sb, bankId } = args;
  const { data: existing, error: existingError } = await sb
    .from("deals")
    .select("id")
    .eq("bank_id", bankId)
    .eq("display_name", FIXTURE_NAME)
    .eq("is_test", true)
    .maybeSingle();
  if (existingError) throw new Error(`fixture lookup: ${existingError.message}`);
  if (existing?.id) return { dealId: existing.id, created: false, fixtureVersion: FIXTURE_VERSION };

  const dealId = crypto.randomUUID();
  const periodStart = "2025-01-01";
  const periodEnd = "2025-12-31";
  const now = new Date().toISOString();

  await requireOk(
    "deal",
    sb.from("deals").insert({
      id: dealId,
      bank_id: bankId,
      name: "Apex Precision Fabrication, LLC",
      display_name: FIXTURE_NAME,
      borrower_name: "Jordan Ellis",
      borrower_email: "golden-trident-qa@test.local",
      deal_type: "SBA",
      product_type: "SBA_7A",
      origin: "brokerage_anonymous",
      loan_amount: 850000,
      city: "Fort Worth",
      state: "TX",
      status: "active",
      is_test: true,
    }),
  );

  try {
    await requireOk(
      "borrower application",
      sb.from("borrower_applications").insert({
        deal_id: dealId,
        business_legal_name: "Apex Precision Fabrication, LLC",
        industry: "Precision machining and fabricated metal products",
        naics: "332710",
        loan_amount: 850000,
        loan_type: "7a",
      }),
    );

    await requireOk(
      "borrower story",
      sb.from("buddy_borrower_stories").insert({
        deal_id: dealId,
        origin_story:
          "Jordan Ellis started Apex after repeatedly seeing regional aerospace and defense suppliers lose production time while waiting on out-of-state machine shops. The company was built to provide accountable, short-run precision work within a one-day drive of its customers.",
        competitive_insight:
          "Apex competes on documented tolerances, rapid quoting, and dependable lead times rather than the lowest unit price. Its strongest customers use Apex for complex, low-volume components where a late or nonconforming part can stop a larger assembly line.",
        ideal_customer:
          "Regional manufacturers and maintenance contractors that require traceable, tight-tolerance parts in recurring low-to-mid-volume runs.",
        growth_strategy:
          "Install a five-axis machining center, add a second shift, and convert overflow work currently declined into contracted capacity while preserving current inspection controls.",
        biggest_risk:
          "The primary execution risk is ramping the second shift quickly enough to absorb the new equipment payment without weakening on-time delivery or quality control.",
        personal_vision:
          "Build a durable regional employer known for craftsmanship, apprenticeship, and reliable domestic production capacity.",
        voice_formality: "professional",
        voice_metaphors: ["capacity is the constraint", "quality earns the next order"],
        voice_values: ["craftsmanship", "accountability", "domestic manufacturing"],
        captured_via: "form",
      }),
    );

    const sourceDocs = [
      {
        filename: "qa_2025_business_financials.pdf",
        canonicalType: "BUSINESS_TAX_RETURN",
        checklistKey: "BUSINESS_TAX_RETURN",
        lines: [
          "Revenue: $2,400,000", "Cost of goods sold: $1,320,000", "Operating expenses: $720,000",
          "EBITDA: $360,000", "Depreciation: $90,000", "Interest expense: $45,000",
          "Income tax: $35,000", "Net income: $190,000", "Annual debt service: $120,000",
        ],
      },
      {
        filename: "qa_2025_balance_sheet.pdf",
        canonicalType: "BALANCE_SHEET",
        checklistKey: "BALANCE_SHEET",
        lines: [
          "Cash: $240,000", "Accounts receivable: $310,000", "Inventory: $180,000",
          "Fixed assets: $950,000", "Total assets: $1,680,000", "Accounts payable: $210,000",
          "Long-term debt: $620,000", "Total liabilities: $830,000", "Total equity: $850,000",
          "Years in business: 9",
        ],
      },
    ];

    const documentIds: string[] = [];
    for (const doc of sourceDocs) {
      const path = `qa/golden-trident/${dealId}/${doc.filename}`;
      const bytes = await evidencePdf(doc.filename.replace(/_/g, " "), doc.lines);
      const { error: uploadError } = await sb.storage.from("deal-documents").upload(path, bytes, {
        contentType: "application/pdf",
        upsert: true,
      });
      if (uploadError) throw new Error(`source upload: ${uploadError.message}`);
      const ingested = await ingestDocument({
        dealId,
        bankId,
        file: {
          original_filename: doc.filename,
          mimeType: "application/pdf",
          sizeBytes: bytes.byteLength,
          storagePath: path,
          storageBucket: "deal-documents",
        },
        source: "system",
        documentKey: `${FIXTURE_VERSION}:${doc.filename}`,
        metadata: {
          task_checklist_key: doc.checklistKey,
          synthetic_qa_fixture: FIXTURE_VERSION,
        },
      });
      const { error: docError } = await sb
        .from("deal_documents")
        .update({ canonical_type: doc.canonicalType })
        .eq("id", ingested.documentId)
        .eq("deal_id", dealId);
      if (docError) throw new Error(`source typing: ${docError.message}`);
      documentIds.push(ingested.documentId);
    }

    const incomeDocId = documentIds[0];
    const balanceDocId = documentIds[1];
    const facts = [
      ["TOTAL_REVENUE", 2400000, incomeDocId], ["COST_OF_GOODS_SOLD", 1320000, incomeDocId],
      ["TOTAL_OPERATING_EXPENSES", 720000, incomeDocId], ["EBITDA", 360000, incomeDocId],
      ["DEPRECIATION", 90000, incomeDocId], ["INTEREST_EXPENSE", 45000, incomeDocId],
      ["TOTAL_TAX", 35000, incomeDocId], ["NET_INCOME", 190000, incomeDocId], ["ADS", 120000, incomeDocId],
      ["CASH", 240000, balanceDocId], ["ACCOUNTS_RECEIVABLE", 310000, balanceDocId],
      ["INVENTORY", 180000, balanceDocId], ["TOTAL_FIXED_ASSETS", 950000, balanceDocId],
      ["ACCOUNTS_PAYABLE", 210000, balanceDocId], ["TOTAL_LONG_TERM_DEBT", 620000, balanceDocId],
      ["TOTAL_ASSETS", 1680000, balanceDocId], ["TOTAL_LIABILITIES", 830000, balanceDocId],
      ["TOTAL_EQUITY", 850000, balanceDocId], ["YEARS_IN_BUSINESS", 9, balanceDocId],
    ].map(([factKey, value, sourceDocumentId]) => ({
      deal_id: dealId,
      bank_id: bankId,
      source_document_id: sourceDocumentId,
      fact_type: "qa_certified_financial",
      fact_key: factKey,
      fact_period_start: periodStart,
      fact_period_end: periodEnd,
      fact_value_num: value,
      confidence: 1,
      provenance: { source: FIXTURE_VERSION, synthetic: true, certifiedForQa: true },
    }));
    await requireOk("financial facts", sb.from("deal_financial_facts").insert(facts));

    await requireOk(
      "sources and uses",
      sb.from("deal_proceeds_items").insert([
        { deal_id: dealId, category: "Equipment", description: "Five-axis machining center, tooling, installation", amount: 750000 },
        { deal_id: dealId, category: "Working Capital", description: "Hiring, training, materials, and ramp reserve", amount: 250000 },
      ]),
    );

    await requireOk(
      "confirmed assumptions",
      sb.from("buddy_sba_assumptions").insert({
        deal_id: dealId,
        status: "confirmed",
        confirmed_at: now,
        revenue_streams: [
          {
            id: "precision-machining", name: "Precision machining", baseAnnualRevenue: 1800000,
            growthRateYear1: 0.09, growthRateYear2: 0.07, growthRateYear3: 0.06,
            pricingModel: "per_unit", seasonalityProfile: null,
          },
          {
            id: "fabrication-repair", name: "Fabrication and repair", baseAnnualRevenue: 600000,
            growthRateYear1: 0.06, growthRateYear2: 0.05, growthRateYear3: 0.04,
            pricingModel: "flat", seasonalityProfile: null,
          },
        ],
        cost_assumptions: {
          cogsPercentYear1: 0.55, cogsPercentYear2: 0.545, cogsPercentYear3: 0.54,
          fixedCostCategories: [
            { name: "Payroll and benefits", annualAmount: 430000, escalationPctPerYear: 0.03 },
            { name: "Occupancy and utilities", annualAmount: 150000, escalationPctPerYear: 0.025 },
            { name: "Insurance, software, and administration", annualAmount: 140000, escalationPctPerYear: 0.03 },
          ],
          plannedHires: [
            { role: "Second-shift CNC operator", startMonth: 4, annualSalary: 65000 },
            { role: "Quality technician", startMonth: 7, annualSalary: 58000 },
          ],
          plannedCapex: [{ description: "Five-axis machining center and tooling", amount: 750000, year: 1 }],
        },
        working_capital: { targetDSO: 42, targetDPO: 30, inventoryTurns: 7 },
        loan_impact: {
          loanAmount: 850000, termMonths: 120, interestRate: 0.105,
          existingDebt: [{ description: "Existing equipment notes", currentBalance: 620000, monthlyPayment: 10000, remainingTermMonths: 72 }],
          revenueImpactStartMonth: 4, revenueImpactPct: 0.08,
          revenueImpactDescription: "New five-axis capacity converts documented overflow demand and supports a second shift.",
          equityInjectionAmount: 150000, equityInjectionSource: "cash_savings",
          sellerFinancingAmount: 0, sellerFinancingTermMonths: 0, sellerFinancingRate: 0, otherSources: [],
        },
        management_team: [
          {
            name: "Jordan Ellis", title: "Founder and President", ownershipPct: 100, yearsInIndustry: 17,
            bio: "Jordan has seventeen years of machining and plant-operations experience, including responsibility for quoting, scheduling, and quality systems. Jordan founded Apex nine years ago and has led it through two equipment expansions without a customer loss.",
          },
          {
            name: "Renee Morgan", title: "Operations Manager", ownershipPct: 0, yearsInIndustry: 12,
            bio: "Renee manages production scheduling, supplier coordination, and on-time delivery. She previously supervised multi-shift precision-manufacturing teams and will lead the second-shift ramp plan.",
          },
        ],
      }),
    );

    await requireOk(
      "assumption audit event",
      sb.from("buddy_sba_assumptions_events").insert({
        deal_id: dealId,
        bank_id: bankId,
        event_type: "qa_fixture_confirmed",
        detail: { fixtureVersion: FIXTURE_VERSION, synthetic: true },
      }),
    );
  } catch (error) {
    await sb.from("deals").delete().eq("id", dealId).eq("is_test", true);
    throw error;
  }

  return { dealId, created: true, fixtureVersion: FIXTURE_VERSION };
}
