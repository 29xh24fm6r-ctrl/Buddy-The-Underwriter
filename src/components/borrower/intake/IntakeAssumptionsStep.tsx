"use client";

// src/components/borrower/intake/IntakeAssumptionsStep.tsx
// SPEC-BORROWER-STRUCTURED-ASSUMPTIONS-1 — Chapter 4: Financial Assumptions.
//
// This does NOT reimplement revenue/cost/working-capital/loan-impact
// collection. It mounts the existing, already-tested AssumptionInterview
// engine (src/components/borrower/intake/AssumptionInterview.tsx) — same
// field definitions, same validation (sbaAssumptionsValidator.ts), same
// persistence (buddy_sba_assumptions via /api/borrower/portal/[token]/
// sba-assumptions), same calculations. Management team is collected
// earlier in the Ownership & Management chapter, so it's hidden here to
// avoid asking twice.

import { AssumptionInterview } from "./AssumptionInterview";

export function IntakeAssumptionsStep({
  dealId,
  onContinue,
}: {
  dealId: string;
  onContinue: () => void;
}) {
  return (
    <div className="space-y-6">
      {/* Buddy bubble */}
      <div className="flex gap-3">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-blue-500 to-brand-blue-400 text-sm font-bold text-white">
          B
        </div>
        <div className="rounded-2xl rounded-bl-md bg-slate-100 px-5 py-3.5">
          <p className="text-sm text-slate-800">
            Now I need the numbers behind your loan — revenue, costs, and how
            the financing fits together. This is what turns your application
            into real projections, a feasibility study, and your business
            plan.
          </p>
        </div>
      </div>

      <AssumptionInterview
        token={dealId}
        dealId={dealId}
        showManagementStep={false}
        onConfirmAndContinue={onContinue}
      />
    </div>
  );
}
