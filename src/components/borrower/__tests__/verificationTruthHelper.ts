import type { DealVerificationState } from "@/components/borrower/intake/IntakeReviewStep";

type ReviewItem = {
  key: string;
  label: string;
  detail: string;
  status: "complete" | "pending" | "flagged";
  source: string;
  resolveChapter?: number;
};

export function buildReviewItemsForTest(
  purposes: string[],
  verifications: DealVerificationState,
): ReviewItem[] {
  const isFranchise = purposes.includes("franchise");
  const items: ReviewItem[] = [
    {
      key: "financing",
      label: "Financing scope",
      detail: purposes.length > 0 ? "Use of funds defined and totaled" : "No purposes selected",
      status: purposes.length > 0 ? "complete" : "flagged",
      source: "purposes",
      resolveChapter: 1,
    },
    {
      key: "business",
      label: "Business verification",
      detail: verifications.entityResolved ? "Entity matched" : "Not started",
      status: verifications.entityResolved ? "complete" : "pending",
      source: "entity_resolution",
      resolveChapter: 2,
    },
    {
      key: "ownership",
      label: "Ownership",
      detail: verifications.identityVerified ? "Identity verified" : "Not started",
      status: verifications.identityVerified ? "complete" : "pending",
      source: "borrower_identity_verifications",
      resolveChapter: 3,
    },
    {
      key: "financials",
      label: "Financials",
      detail: verifications.financialsExtracted ? "Documents received" : "Not started",
      status: verifications.financialsExtracted ? "complete" : "pending",
      source: "deal_documents",
      resolveChapter: 4,
    },
  ];
  if (isFranchise) {
    items.push({
      key: "franchise",
      label: "Franchise Directory match",
      detail: verifications.franchiseMatched ? "Brand confirmed SBA-eligible" : "Not started",
      status: verifications.franchiseMatched ? "complete" : "pending",
      source: "franchise_directory_match",
    });
  }
  return items;
}

export function deriveVerificationsForTest(counts: {
  identityVerificationCount: number;
  ownershipEntityCount: number;
  documentsUploadedCount: number;
  franchiseMatched?: boolean;
}): DealVerificationState {
  return {
    entityResolved: counts.ownershipEntityCount >= 1,
    identityVerified: counts.identityVerificationCount >= 1,
    financialsExtracted: counts.documentsUploadedCount > 0,
    franchiseMatched: counts.franchiseMatched ?? false,
  };
}
