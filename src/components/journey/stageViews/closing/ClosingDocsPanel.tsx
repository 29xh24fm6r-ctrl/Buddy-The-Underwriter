"use client";

import { useCockpitDataContext } from "@/buddy/cockpit/useCockpitData";
import { StatusListPanel } from "../_shared/StatusListPanel";

/**
 * Closing docs readiness panel. Reads document readiness signals from
 * lifecycleState.derived (gatekeeper-authoritative) and lifecycle blockers
 * for `closing_docs_missing`.
 */
export function ClosingDocsPanel({ dealId }: { dealId: string }) {
  const { lifecycleState } = useCockpitDataContext();
  const derived = lifecycleState?.derived;
  const blockers = lifecycleState?.blockers ?? [];

  const closingDocsMissing = blockers.find((b) => b.code === "closing_docs_missing");
  const pricingQuoteMissing = blockers.find((b) => b.code === "pricing_quote_missing");
  const riskPricingNotFinalized = blockers.find(
    (b) => b.code === "risk_pricing_not_finalized",
  );

  const docsReady = derived?.documentsReady ?? false;
  const readinessPct = derived?.documentsReadinessPct ?? 0;

  const rows = [
    {
      id: "documents-ready",
      label: "Documents",
      detail: docsReady
        ? "All required documents present."
        : `${readinessPct}% of required documents present.`,
      tone: docsReady ? ("success" as const) : ("warn" as const),
      badge: docsReady ? "READY" : `${readinessPct}%`,
    },
    {
      id: "closing-docs",
      label: "Closing docs",
      detail: closingDocsMissing
        ? closingDocsMissing.message
        : "Closing docs are not flagged as missing.",
      tone: closingDocsMissing ? ("warn" as const) : ("success" as const),
      badge: closingDocsMissing ? "MISSING" : "OK",
    },
    {
      id: "pricing-quote",
      label: "Pricing quote",
      detail: pricingQuoteMissing
        ? pricingQuoteMissing.message
        : "Pricing quote is locked.",
      tone: pricingQuoteMissing ? ("warn" as const) : ("success" as const),
      badge: pricingQuoteMissing ? "MISSING" : "LOCKED",
    },
    {
      id: "risk-pricing",
      label: "Risk-based pricing",
      detail: riskPricingNotFinalized
        ? riskPricingNotFinalized.message
        : "Risk pricing is finalized.",
      tone: riskPricingNotFinalized ? ("warn" as const) : ("success" as const),
      badge: riskPricingNotFinalized ? "PENDING" : "FINAL",
    },
  ];

  const anyBlocked = Boolean(
    closingDocsMissing || pricingQuoteMissing || riskPricingNotFinalized,
  );

  return (
    <StatusListPanel
      testId="closing-docs-panel"
      title="Closing Docs"
      icon="description"
      badge={!lifecycleState ? "PENDING" : anyBlocked ? "BLOCKED" : "READY"}
      badgeTone={anyBlocked ? "warn" : "success"}
      summary={
        !lifecycleState
          ? "Loading closing readiness…"
          : anyBlocked
            ? "Closing is blocked by missing docs or unfinalized pricing."
            : "Closing docs and pricing are in place."
      }
      rows={rows}
      links={[
        { label: "Documents", href: `/deals/${dealId}/documents` },
        { label: "Pricing", href: `/deals/${dealId}/pricing` },
      ]}
    />
  );
}
