import type {
  Explainability,
  PricingInputs,
  PricingQuoteCore,
} from "@/lib/pricing/explainability";
import type { IndexRate } from "@/lib/rates/indexRates";

export function buildPricingMemoMarkdown(args: {
  dealName: string;
  quoteId: string;
  inputs: PricingInputs;
  latestRate: IndexRate;
  quote: PricingQuoteCore;
  explain: Explainability;
}) {
  const { dealName, quoteId, inputs, latestRate, quote, explain } = args;

  const lines: string[] = [];
  lines.push(`### Pricing Summary`);
  lines.push(`- **Deal:** ${dealName}`);
  lines.push(`- **Quote ID:** \`${quoteId}\``);
  lines.push(
    `- **Index:** ${inputs.index_code} (**${latestRate.ratePct.toFixed(2)}%** as of ${latestRate.asOf}, source: ${latestRate.source})`,
  );
  lines.push(`- **Spread:** **${quote.spread_bps} bps**`);
  lines.push(`- **All-in Rate:** **${quote.all_in_rate_pct.toFixed(2)}%**`);
  lines.push(
    `- **Term / Amort / IO:** ${inputs.term_months} mo / ${inputs.amort_months} mo / ${inputs.interest_only_months} mo`,
  );

  if (inputs.loan_amount != null && quote.payment_pi_monthly != null) {
    lines.push(
      `- **Est. Monthly P&I:** **$${Math.round(quote.payment_pi_monthly).toLocaleString()}**`,
    );
  }
  if (
    inputs.loan_amount != null &&
    quote.payment_io_monthly != null &&
    inputs.interest_only_months > 0
  ) {
    lines.push(
      `- **Est. Monthly IO:** **$${Math.round(quote.payment_io_monthly).toLocaleString()}**`,
    );
  }

  lines.push("");
  lines.push(`### Pricing Rationale (Explainability)`);
  lines.push(`- **Confidence:** ${(explain.confidence * 100).toFixed(0)}%`);
  lines.push(`- **Summary:** ${explain.summary}`);

  lines.push("");
  lines.push(`#### Drivers`);
  for (const d of explain.drivers) {
    const sign = d.bps >= 0 ? "+" : "";
    lines.push(
      `- ${d.label}: **${sign}${d.bps} bps**${d.reason ? ` — ${d.reason}` : ""}`,
    );
  }

  if (explain.missingInputs.length) {
    lines.push("");
    lines.push(`#### Missing Inputs (Improves Accuracy)`);
    for (const m of explain.missingInputs) {
      lines.push(
        `- ${m.label}${m.impactBps != null ? ` (impact ~${m.impactBps} bps)` : ""}`,
      );
    }
  }

  return lines.join("\n");
}
