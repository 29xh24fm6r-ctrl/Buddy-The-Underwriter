"use server";

import { getAIProvider } from "@/lib/ai/provider";
import { getLatestRiskRun, getLatestMemo } from "@/lib/db/server";
import { append } from "../(shell)/committee/_components/committeeStore";
import { getEvidenceCatalogForAI } from "@/lib/evidence/getEvidenceCatalog";
import { retrieveTopChunks } from "@/lib/retrieval/retrieve";
import { aiRerankChunks } from "@/lib/retrieval/rerank";

export async function askCommitteeAction(dealId: string, question: string) {
  append(dealId, { role: "user", content: question });

  const provider = getAIProvider();
  const riskRun = await getLatestRiskRun(dealId);
  const memo = await getLatestMemo(dealId);

  // Fetch AI-curated evidence catalog for richer context
  const evidenceCatalog = await getEvidenceCatalogForAI(dealId);

  // 🔥 SEMANTIC RETRIEVAL: Pull the most relevant evidence chunks for this question
  let evidenceContext = "";
  try {
    const retrieved = await retrieveTopChunks({ dealId, query: question, k: 20 });
    if (retrieved.length > 0) {
      const reranked = await aiRerankChunks({ query: question, chunks: retrieved, topN: 8 });
      evidenceContext = reranked.kept
        .map((c) => `PAGES ${c.pageStart}-${c.pageEnd}\n${c.content}`)
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

  const ans = await provider.chatAboutDeal({
    dealId,
    question,
    dealSnapshot,
    risk: riskRun?.outputs ?? null,
    memo: memo ? memo.sections.map((s) => `${s.title}\n${s.content}`).join("\n\n") : null,
  });

  append(dealId, { role: "assistant", content: ans.answer, citations: ans.citations, followups: ans.followups });

  return { ok: true };
}
