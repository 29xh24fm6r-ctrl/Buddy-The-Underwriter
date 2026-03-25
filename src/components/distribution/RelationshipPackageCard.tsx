"use client";

import type { RelationshipDistributionPackage } from "@/lib/distribution/types";

type Props = {
  pkg: RelationshipDistributionPackage;
  onCreateOutreach?: () => void;
};

const glass = "rounded-xl border border-white/10 bg-white/[0.03] p-4";

export function RelationshipPackageCard({ pkg, onCreateOutreach }: Props) {
  const totalFees = pkg.treasury_proposals.reduce((sum, p) => sum + (p.estimated_annual_fee ?? 0), 0);

  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold text-white">Relationship Expansion</div>

      {/* Treasury proposals */}
      {pkg.treasury_proposals.length > 0 ? (
        <div className={glass}>
          <div className="text-xs font-semibold text-white/50 mb-2">
            Recommended Treasury Products ({pkg.treasury_proposals.length})
          </div>
          <div className="space-y-2">
            {pkg.treasury_proposals.map((p, i) => (
              <div key={i} className="flex justify-between items-start text-xs">
                <div>
                  <div className="text-white font-medium">{p.product}</div>
                  <div className="text-white/50">{p.rationale}</div>
                </div>
                {p.estimated_annual_fee != null && (
                  <span className="text-white/70 shrink-0">${p.estimated_annual_fee.toLocaleString()}/yr</span>
                )}
              </div>
            ))}
          </div>
          {totalFees > 0 && (
            <div className="flex justify-between text-xs font-semibold border-t border-white/10 pt-2 mt-2">
              <span className="text-white/70">Estimated Annual Fee Income</span>
              <span className="text-emerald-300">${totalFees.toLocaleString()}</span>
            </div>
          )}
        </div>
      ) : (
        <div className={`${glass} text-xs text-white/40 text-center`}>
          No treasury recommendations available.
        </div>
      )}

      {/* Relationship pricing */}
      {pkg.relationship_pricing_summary && (
        <div className={glass}>
          <div className="text-xs font-semibold text-white/50 mb-1">Relationship Pricing</div>
          <div className="text-xs text-white/70">{pkg.relationship_pricing_summary}</div>
        </div>
      )}

      {/* RM Summary */}
      {pkg.rm_summary && (
        <div className={glass}>
          <div className="text-xs font-semibold text-white/50 mb-1">RM Summary</div>
          <div className="text-xs text-white/70">{pkg.rm_summary}</div>
        </div>
      )}

      {/* Compliance note */}
      <div className="rounded-xl border border-amber-500/15 bg-amber-600/5 p-3">
        <div className="text-[10px] text-amber-300/60">{pkg.compliance_note}</div>
      </div>

      {/* CTA */}
      {onCreateOutreach && (
        <button
          type="button"
          onClick={onCreateOutreach}
          className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-xs font-semibold text-white/80 hover:bg-white/10"
        >
          Create RM Outreach Package
        </button>
      )}
    </div>
  );
}
