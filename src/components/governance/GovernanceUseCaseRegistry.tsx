"use client";

/**
 * GovernanceUseCaseRegistry
 *
 * Read-only table displaying every AI use case registered in buddy_ai_use_cases.
 * Shows: mission name, risk tier, automation level, approval status.
 *
 * This is displayed in the /governance route group for bank compliance officers
 * and examiners to verify that all AI capabilities are properly registered.
 */

import React from "react";

type RiskTier = "low" | "medium" | "high";
type AutomationLevel = "auto" | "human_in_loop" | "restricted";
type ApprovalStatus = "approved" | "pending_review" | "restricted";

export type UseCaseRow = {
  id: string;
  mission_type: string;
  name: string;
  description: string;
  risk_tier: RiskTier;
  automation_level: AutomationLevel;
  approval_status: ApprovalStatus;
  approved_by: string | null;
  approved_at: string | null;
};

function riskBadge(tier: RiskTier) {
  const colors: Record<RiskTier, string> = {
    low: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    medium: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    high: "bg-red-500/20 text-red-400 border-red-500/30",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${colors[tier]}`}>
      {tier.toUpperCase()}
    </span>
  );
}

function automationBadge(level: AutomationLevel) {
  const labels: Record<AutomationLevel, string> = {
    auto: "Auto",
    human_in_loop: "Human-in-Loop",
    restricted: "Restricted",
  };
  const colors: Record<AutomationLevel, string> = {
    auto: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    human_in_loop: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    restricted: "bg-red-500/20 text-red-400 border-red-500/30",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${colors[level]}`}>
      {labels[level]}
    </span>
  );
}

function approvalBadge(status: ApprovalStatus) {
  const labels: Record<ApprovalStatus, string> = {
    approved: "Approved",
    pending_review: "Pending Review",
    restricted: "Restricted",
  };
  const colors: Record<ApprovalStatus, string> = {
    approved: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    pending_review: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    restricted: "bg-red-500/20 text-red-400 border-red-500/30",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${colors[status]}`}>
      {labels[status]}
    </span>
  );
}

export function GovernanceUseCaseRegistry({ useCases }: { useCases: UseCaseRow[] }) {
  const approvedCount = useCases.filter((uc) => uc.approval_status === "approved").length;
  const pendingCount = useCases.filter((uc) => uc.approval_status === "pending_review").length;
  const restrictedCount = useCases.filter((uc) => uc.approval_status === "restricted").length;

  return (
    <div className="space-y-4">
      {/* Summary row */}
      <div className="flex gap-4 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500" />
          <span className="text-white/70">{approvedCount} Approved</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-amber-500" />
          <span className="text-white/70">{pendingCount} Pending</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-red-500" />
          <span className="text-white/70">{restrictedCount} Restricted</span>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-white/10">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 bg-white/[0.03]">
              <th className="text-left px-4 py-3 font-medium text-white/60">Use Case</th>
              <th className="text-left px-4 py-3 font-medium text-white/60">Risk Tier</th>
              <th className="text-left px-4 py-3 font-medium text-white/60">Automation</th>
              <th className="text-left px-4 py-3 font-medium text-white/60">Approval</th>
              <th className="text-left px-4 py-3 font-medium text-white/60">Approved By</th>
            </tr>
          </thead>
          <tbody>
            {useCases.map((uc) => (
              <tr
                key={uc.id}
                className="border-b border-white/5 hover:bg-white/[0.02] transition-colors"
              >
                <td className="px-4 py-3">
                  <div className="font-medium text-white">{uc.name}</div>
                  <div className="text-xs text-white/40 mt-0.5">{uc.description}</div>
                </td>
                <td className="px-4 py-3">{riskBadge(uc.risk_tier)}</td>
                <td className="px-4 py-3">{automationBadge(uc.automation_level)}</td>
                <td className="px-4 py-3">{approvalBadge(uc.approval_status)}</td>
                <td className="px-4 py-3 text-white/50 text-xs">
                  {uc.approved_by ? (
                    <div>
                      <div>{uc.approved_by}</div>
                      {uc.approved_at && (
                        <div className="text-white/30">
                          {new Date(uc.approved_at).toLocaleDateString()}
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className="text-white/30">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Governance enforcement note */}
      <div className="text-xs text-white/40 bg-white/[0.02] rounded-lg p-3 border border-white/5">
        <strong className="text-white/60">Enforcement Rule:</strong> A mission may only auto-run
        if its approval status is <em>Approved</em> and automation level is <em>Auto</em>.
        Missions marked <em>Human-in-Loop</em> require explicit banker approval before execution.
        <em>Restricted</em> missions are blocked entirely.
      </div>
    </div>
  );
}
