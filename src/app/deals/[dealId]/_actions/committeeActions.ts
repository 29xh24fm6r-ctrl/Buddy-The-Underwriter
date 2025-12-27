"use server";

import { getAIProvider } from "@/lib/ai/provider";
import { getLatestRiskRun, getLatestMemo } from "@/lib/db/server";
import { append } from "../(shell)/committee/_components/committeeStore";
import { getEvidenceCatalogForAI } from "@/lib/evidence/getEvidenceCatalog";

export async function askCommitteeAction(dealId: string, question: string) {
  append(dealId, { role: "user", content: question });

  const provider = getAIProvider();
  const riskRun = await getLatestRiskRun(dealId);
  const memo = await getLatestMemo(dealId);

  // Fetch AI-curated evidence catalog for richer context
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
