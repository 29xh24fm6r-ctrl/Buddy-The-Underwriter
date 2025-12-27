"use server";

import { getAIProvider } from "@/lib/ai/provider";
import type { RiskInput, MemoInput } from "@/lib/ai/provider";
import { insertRiskRun, getLatestRiskRun, insertMemoRun } from "@/lib/db/server";
import { getEvidenceCatalogForAI } from "@/lib/evidence/getEvidenceCatalog";

export async function generateRiskAction(dealId: string) {
  const provider = getAIProvider();

  // Fetch AI-curated evidence catalog (facts, metrics, risks, mitigants)
  const evidenceCatalog = await getEvidenceCatalogForAI(dealId);

  // Release-friendly snapshot; wire to real deal fetch later
  const dealSnapshot = {
    borrowerName: "Acme Logistics LLC",
    industry: "Logistics",
    requestAmount: "$2,500,000",
    term: "24 months",
    collateral: "A/R + Inventory",
    facilityType: "ABL Revolver",
    yearsInBusiness: 8,
    evidenceCatalog, // Include catalog for model context
  };

  const input: RiskInput = {
    dealId,
    dealSnapshot,
    evidenceIndex: [
      { docId: "doc-bank-statements", label: "Bank Statements (mock)", kind: "pdf" },
      { docId: "doc-ar-aging", label: "A/R Aging (mock)", kind: "pdf" },
      { docId: "doc-inventory", label: "Inventory Report (mock)", kind: "pdf" },
    ],
  };

  const output = await provider.generateRisk(input);
  const riskRun = await insertRiskRun(dealId, input, output);

  return { riskRunId: riskRun.id };
}

export async function generateMemoAction(dealId: string) {
  const provider = getAIProvider();

  const latestRisk = await getLatestRiskRun(dealId);
  if (!latestRisk) {
    throw new Error("No risk run found. Generate risk first.");
  }

  // Fetch AI-curated evidence catalog
  const evidenceCatalog = await getEvidenceCatalogForAI(dealId);

  const dealSnapshot = {
    borrowerName: "Acme Logistics LLC",
    industry: "Logistics",
    requestAmount: "$2,500,000",
    term: "24 months",
    collateral: "A/R + Inventory",
    facilityType: "ABL Revolver",
    yearsInBusiness: 8,
    evidenceCatalog, // Include catalog for model context
  };

  const input: MemoInput = {
    dealId,
    dealSnapshot,
    risk: latestRisk.outputs,
  };

  const output = await provider.generateMemo(input);
  const memo = await insertMemoRun(dealId, latestRisk.id, input, output);

  return { memoRunId: memo.run.id };
}
