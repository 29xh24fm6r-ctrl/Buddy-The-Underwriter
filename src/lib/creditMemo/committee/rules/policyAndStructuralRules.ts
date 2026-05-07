// Pure policy + structural rules.

import type { CommitteeObjection, CommitteeRule } from "../types";

export const policyRules: CommitteeRule = (inputs) => {
  const out: CommitteeObjection[] = [];
  const dealId = inputs.dealId;

  if (inputs.openPolicyExceptionsCount > 0) {
    out.push({
      code: "policy_open_exceptions",
      domain: "policy",
      severity: "hard",
      label: `${inputs.openPolicyExceptionsCount} open policy exception(s)`,
      rationale:
        "Open policy exceptions are committee-blocking until each is documented and accepted.",
      mitigant:
        "Document the rationale, mitigant, and any compensating control for each exception.",
      fixPath: `/deals/${dealId}/policy-exceptions`,
      source: {
        metric: "open_policy_exceptions",
        value: inputs.openPolicyExceptionsCount,
      },
    });
  }

  if (!inputs.pricing.decided) {
    out.push({
      code: "policy_pricing_not_decided",
      domain: "policy",
      severity: "hard",
      label: "Pricing decision not finalized",
      rationale:
        "Committee will not approve a memo without an authoritative pricing decision and rate.",
      fixPath: `/deals/${dealId}/pricing`,
      source: { metric: "pricing_decided", value: "no" },
    });
  } else if (inputs.pricing.rate_initial_pct === null) {
    out.push({
      code: "policy_pricing_rate_missing",
      domain: "policy",
      severity: "soft",
      label: "Pricing decision exists but rate is unspecified",
      rationale:
        "Pricing was finalized but the initial rate field is null — committee will ask for the rate.",
      fixPath: `/deals/${dealId}/pricing`,
      source: { metric: "rate_initial_pct", value: null },
    });
  }

  return out;
};

export const structuralRules: CommitteeRule = (inputs) => {
  const out: CommitteeObjection[] = [];
  const dealId = inputs.dealId;

  if (!inputs.covenantPackagePresent) {
    out.push({
      code: "structural_no_covenant_package",
      domain: "structural",
      severity: "soft",
      label: "No covenant package on file",
      rationale:
        "Committee expects a recommended covenant package — DSCR / leverage / liquidity covenants strengthen the credit story.",
      mitigant:
        "Draft a covenant package proportional to risk tier; even a financial-reporting-only package is better than none.",
      fixPath: `/deals/${dealId}/credit-memo`,
      source: { metric: "covenant_package", value: "missing" },
    });
  }

  if (inputs.memoInput.managementProfilesCount === 0) {
    out.push({
      code: "structural_no_guarantor_documented",
      domain: "guarantor",
      severity: "hard",
      label: "Guarantor / sponsor not documented",
      rationale:
        "No management or guarantor profile is on file — committee cannot evaluate sponsor strength.",
      fixPath: `/deals/${dealId}/memo-inputs#management`,
      source: { metric: "management_profiles_count", value: 0 },
    });
  }

  return out;
};
