"use server";

import { getAIProvider } from "@/lib/ai/provider";
import type { RiskInput, MemoInput } from "@/lib/ai/provider";
import { insertRiskRun, getLatestRiskRun, insertMemoRun } from "@/lib/db/server";
import { getEvidenceCatalogForAI } from "@/lib/evidence/getEvidenceCatalog";
import { retrieveTopChunks } from "@/lib/retrieval/retrieve";
import { aiRerankChunks } from "@/lib/retrieval/rerank";
import { mapEvidenceChunkRow } from "@/lib/db/rowCase";

export async function generateRiskAction(dealId: string) {
  const provider = getAIProvider();

  // Fetch AI-curated evidence catalog (facts, metrics, risks, mitigants)
  const evidenceCatalog = await getEvidenceCatalogForAI(dealId);

  // 🔥 SEMANTIC RETRIEVAL: Pull relevant evidence for risk assessment
  let evidenceContext = "";
  try {
    const riskQuery =
      "credit risk factors revenue volatility customer concentration collateral coverage debt service DSCR financial covenants";
    const retrieved = await retrieveTopChunks({ dealId, question: riskQuery, k: 24 });
    if (retrieved.length > 0) {
      const reranked = await aiRerankChunks({
        query: riskQuery,
        chunks: retrieved,
        topN: 10,
      });
      evidenceContext = reranked.kept
        .map((c) => `PAGES ${c.pageStart ?? c.page_start}-${c.pageEnd ?? c.page_end}\n${c.content}`)
        .join("\n\n---\n\n");
    }
  } catch (e: any) {
    console.warn("Semantic retrieval failed (embeddings may not exist yet):", e.message);
  }

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
    evidenceContext, // Include semantically retrieved chunks
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

  // 🔥 SEMANTIC RETRIEVAL: Pull relevant evidence for memo
  let evidenceContext = "";
  try {
    const memoQuery =
      "credit memo executive summary risks mitigants pricing covenants DSCR revenue volatility concentration collateral advance rates";
    const memoRetrieved = await retrieveTopChunks({ dealId, query: memoQuery, k: 24 });
    if (memoRetrieved.length > 0) {
      const memoReranked = await aiRerankChunks({
        query: memoQuery,
        chunks: memoRetrieved,
        topN: 10,
      });
      evidenceContext = memoReranked.kept
        .map((c) => `PAGES ${c.pageStart ?? c.page_start}-${c.pageEnd ?? c.page_end}\n${c.content}`)
        .join("\n\n---\n\n");
    }
  } catch (e: any) {
    console.warn("Semantic retrieval failed (embeddings may not exist yet):", e.message);
  }

  const dealSnapshot = {
    borrowerName: "Acme Logistics LLC",
    industry: "Logistics",
    requestAmount: "$2,500,000",
    term: "24 months",
    collateral: "A/R + Inventory",
    facilityType: "ABL Revolver",
    yearsInBusiness: 8,
    evidenceCatalog, // Include catalog for model context
    evidenceContext, // Include semantically retrieved chunks
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