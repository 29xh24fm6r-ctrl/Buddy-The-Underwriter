// Pure industry-specific rules. Conservative — only fires when the
// research mission has classified the borrower's industry and the industry
// has well-known committee concerns.

import type { CommitteeObjection, CommitteeRule } from "../types";

type IndustryRule = {
  matcher: RegExp;
  code: string;
  label: string;
  rationale: string;
  mitigant: string;
};

const INDUSTRY_RULES: IndustryRule[] = [
  {
    matcher: /restaurant|food\s*service|hospitality/i,
    code: "industry_restaurant_volatility",
    label: "Restaurant / hospitality industry — high failure rate cohort",
    rationale:
      "Restaurants have above-average failure rates; committee will probe seasonality, food cost trends, and labor cost.",
    mitigant:
      "Lead with multi-year EBITDA stability, brand strength, and disciplined unit economics.",
  },
  {
    matcher: /construction|contractor|general\s*contractor/i,
    code: "industry_construction_cyclicality",
    label: "Construction industry — cyclical and contract-dependent",
    rationale:
      "Construction borrowers face cyclicality, project concentration, and bonding risk; committee will probe backlog quality.",
    mitigant:
      "Emphasize signed-contract backlog, repeat customer base, and bonding capacity.",
  },
  {
    matcher: /retail|brick.?and.?mortar|storefront/i,
    code: "industry_retail_secular_pressure",
    label: "Retail industry — secular margin pressure",
    rationale:
      "Brick-and-mortar retail faces e-commerce displacement; committee will probe foot-traffic and SKU velocity.",
    mitigant:
      "Highlight defensible niche, recurring customer base, or omnichannel revenue mix.",
  },
  {
    matcher: /trucking|long\s*haul|freight/i,
    code: "industry_trucking_diesel_exposure",
    label: "Trucking industry — fuel and rate exposure",
    rationale:
      "Trucking margins are sensitive to diesel prices and contract vs spot rates; committee will probe fuel pass-through clauses.",
    mitigant:
      "Document fuel surcharges, contract-rate share, and lane-level concentration.",
  },
  {
    matcher: /commercial\s*real\s*estate|cre|multifamily|office\s*building/i,
    code: "industry_cre_market_sensitivity",
    label: "Commercial real estate — market and rate sensitivity",
    rationale:
      "CRE valuations are rate-sensitive; committee will probe cap-rate assumptions and rent-roll quality.",
    mitigant:
      "Emphasize stabilized occupancy, WALT, and below-market rent upside if applicable.",
  },
];

export const industryRules = (inputs: import("../types").CommitteeEngineInputs) => {
  const out: import("../types").CommitteeObjection[] = [];
  const industry = inputs.research?.industry?.trim() ?? "";
  if (industry.length === 0) return out;

  for (const rule of INDUSTRY_RULES) {
    if (rule.matcher.test(industry)) {
      out.push({
        code: rule.code,
        domain: "industry",
        severity: "soft",
        label: rule.label,
        rationale: rule.rationale,
        mitigant: rule.mitigant,
        fixPath: `/deals/${inputs.dealId}/research`,
        source: { metric: "research.industry", value: industry },
      });
    }
  }

  return out;
};
