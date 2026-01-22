import "server-only";

import { extractOwnershipFindings } from "@/lib/ownership/extractor";

export type PrincipalFinding = {
  fullName: string;
  ownershipPercentage: number | null;
  role: string | null;
  guarantorLikely: boolean;
  sourceDocId: string | null;
};

export type PrincipalExtractionResult = {
  principals: PrincipalFinding[];
  totalOwnership: number;
  coverageStatus: "ok" | "low" | "high" | "unknown";
  warnings: string[];
};

export function sumOwnershipPercentage(items: Array<{ ownershipPercentage: number | null }>): number {
  return items.reduce((acc, item) => {
    const pct = typeof item.ownershipPercentage === "number" ? item.ownershipPercentage : 0;
    return acc + pct;
  }, 0);
}

export function ownershipCoverageStatus(total: number): PrincipalExtractionResult["coverageStatus"] {
  if (!Number.isFinite(total) || total <= 0) return "unknown";
  if (total >= 99 && total <= 101) return "ok";
  if (total < 99) return "low";
  return "high";
}

export async function extractPrincipalsFromDocs(dealId: string): Promise<PrincipalExtractionResult> {
  const findings = await extractOwnershipFindings(dealId);

  const principals: PrincipalFinding[] = (findings ?? []).map((f: any) => ({
    fullName: String(f.full_name ?? "").trim() || "Unknown",
    ownershipPercentage:
      typeof f.ownership_percent === "number" ? Number(f.ownership_percent) : null,
    role: "Owner",
    guarantorLikely: typeof f.ownership_percent === "number" ? f.ownership_percent >= 20 : false,
    sourceDocId: f.evidence_doc_id ? String(f.evidence_doc_id) : null,
  }));

  const totalOwnership = Math.round(sumOwnershipPercentage(principals) * 100) / 100;
  const coverageStatus = ownershipCoverageStatus(totalOwnership);
  const warnings: string[] = [];

  if (coverageStatus === "low") warnings.push("Ownership totals below 100%.");
  if (coverageStatus === "high") warnings.push("Ownership totals above 100%.");

  return { principals, totalOwnership, coverageStatus, warnings };
}
