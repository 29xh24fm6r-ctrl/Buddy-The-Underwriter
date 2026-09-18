/** Safe, borrower-visible progress. Worker IDs, leases and internal errors stay server-side. */
export type PackagePreparationStatus = {
  id: string;
  status: "running" | "succeeded" | "failed";
  stage: "checking" | "validation" | "research" | "generation";
  message: string | null;
  bundleId: string | null;
};

export const PACKAGE_PREPARATION_LABELS = {
  checking: "Checking your saved answers and project budget",
  validation: "Checking your financial information",
  research: "Preparing research for your business plan",
  generation: "Preparing your application documents",
} as const;

export function hasSavedProceeds(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.length <= 100 &&
    value.every(row => row && typeof row.category === "string" &&
      typeof row.amount === "number" && Number.isFinite(row.amount) && row.amount >= 0) &&
    value.some(row => row.amount > 0);
}
