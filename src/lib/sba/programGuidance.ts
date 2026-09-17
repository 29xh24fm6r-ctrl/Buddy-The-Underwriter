/** Educational navigation only. Eligibility, pricing and approval remain with the existing policy/lender authorities. */
export const PROGRAM_GUIDANCE_VERSION = "2026-09-17";
export type ProgramTopic = {
  id: string;
  name: string;
  why: string;
  check: string;
  source: string;
  fulfillment: "application" | "specialist";
};
export function explainProgramOptions(
  input: {
    goal?: string;
    specialty?: string;
    occupancy?: string;
    stage?: string;
    amount?: number | null;
  },
  asOf = new Date(),
) {
  const topics: ProgramTopic[] = [];
  const add = (topic: ProgramTopic) => topics.push(topic);
  const sba = "https://www.sba.gov/loans/";
  if (input.specialty === "disaster")
    add({
      id: "disaster",
      name: "Disaster assistance",
      why: "You selected disaster recovery.",
      check:
        "Check the applicable declaration and disaster assistance process. This is a separate application path.",
      source: "https://www.sba.gov/disaster/",
      fulfillment: "specialist",
    });
  else if (input.specialty === "grant")
    add({
      id: "grant",
      name: "Funding and preparation support",
      why: "You are looking for a grant rather than borrowing.",
      check:
        "SBA does not offer general grants to start or expand a business. Specific research programs and local assistance may be relevant.",
      source: `${sba}additional-funding-opportunities/grants/`,
      fulfillment: "specialist",
    });
  else if (input.occupancy === "rental")
    add({
      id: "property_review",
      name: "Property financing review",
      why: "You said the property is primarily for renting to others.",
      check:
        "Passive rental investment is not the ordinary owner-occupied SBA property path. A specialist should review the structure and conventional alternatives.",
      source: `${sba}504-loans/`,
      fulfillment: "specialist",
    });
  else if (input.goal) {
    add({
      id: "7a",
      name: "SBA 7(a)",
      why: "A broad program to explore for eligible business purchases, growth, equipment, working capital or refinancing.",
      check:
        "A lender must review the business, repayment ability, ownership, contribution and permitted uses. This is not an eligibility decision or an offer.",
      source: `${sba}7a-loans/`,
      fulfillment: "application",
    });
    if (["property", "equipment", "mixed"].includes(input.goal))
      add({
        id: "504",
        name: "SBA 504",
        why: "Worth comparing when the project includes eligible property or long-life equipment used by the business.",
        check:
          "A CDC and senior lender review the structure. Working capital and inventory need separate financing; occupancy and project components must be checked.",
        source: `${sba}504-loans/`,
        fulfillment: "application",
      });
    if (
      input.amount != null &&
      input.amount > 0 &&
      input.amount <= 50000 &&
      !["property", "refinance"].includes(input.goal)
    )
      add({
        id: "microloan",
        name: "SBA Microloan",
        why: "Your stated request is within the published $50,000 microloan maximum.",
        check:
          "An intermediary decides terms and requirements. Microloans cannot buy real estate or repay existing debt. Buddy does not submit this application.",
        source: `${sba}microloans/`,
        fulfillment: "specialist",
      });
    if (
      ["working_capital", "growth", "mixed"].includes(input.goal) ||
      ["manufacturing", "export", "seasonal"].includes(input.specialty ?? "")
    )
      add({
        id: "working_capital",
        name: "Working capital and specialist options",
        why:
          input.specialty === "export"
            ? "Export sales may need specialist financing."
            : input.specialty === "manufacturing"
              ? "Manufacturing may call for revolving inventory and receivables financing."
              : "Recurring cash needs may need a line rather than a one-time term loan.",
        check:
          "Ask a lender about the relevant WCP, CAPLines, Express, export or MARC route and reporting requirements. Availability and fit require review; these are not interchangeable products.",
        source:
          "https://legacy.sba.gov/partners/lenders/7a-loan-program/types-7a-loans",
        fulfillment: "specialist",
      });
  }
  return {
    topics,
    version: PROGRAM_GUIDANCE_VERSION,
    evaluatedOn: asOf.toISOString().slice(0, 10),
    requiresPolicyRefresh: asOf >= new Date("2026-10-01T00:00:00Z"),
    missing: !input.goal
      ? "Tell us your main goal to explore relevant options."
      : "We still need a lender’s review of your complete facts, current policy and available terms.",
  };
}
