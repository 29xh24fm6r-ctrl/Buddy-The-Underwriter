"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { sampleDeals } from "@/lib/deals/sampleDeals";
import { Deal, DealStage } from "@/lib/deals/types";

export default function DealsPage() {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(sampleDeals[0].id);
  const [stageFilter, setStageFilter] = useState<DealStage | "All">("Underwriting");
  const [blockersOnly, setBlockersOnly] = useState(false);

  const filteredDeals = useMemo(() => {
    let deals = sampleDeals;
    
    if (stageFilter !== "All") {
      deals = deals.filter(d => d.stage === stageFilter);
    }
    
    if (blockersOnly) {
      deals = deals.filter(d => d.blocker != null);
    }
    
    return deals;
  }, [stageFilter, blockersOnly]);

  const selectedDeal = sampleDeals.find(d => d.id === selectedId) || sampleDeals[0];

  // Stage counts
  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {
      All: sampleDeals.length,
      New: 0,
      Underwriting: 0,
      Credit: 0,
      Approved: 0,
      Closed: 0,
    };
    sampleDeals.forEach(d => {
      counts[d.stage]++;
    });
    return counts;
  }, []);

  return (
    <div className="overflow-hidden h-screen flex flex-col bg-background-dark text-white font-display">
      {/* Global Header */}
      <header className="h-14 bg-surface-dark border-b border-border-dark flex items-center px-6 shrink-0">
        <div className="flex items-center gap-3 flex-1">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center">
            <span className="text-sm font-bold">B</span>
          </div>
          <h1 className="text-sm font-semibold">Buddy The Underwriter</h1>
        </div>
        
        <div className="flex items-center gap-2">
          <button className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/10 text-text-secondary hover:text-white transition-colors">
            <span className="material-symbols-outlined text-[20px]">search</span>
          </button>
          <button className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/10 text-text-secondary hover:text-white transition-colors">
            <span className="material-symbols-outlined text-[20px]">notifications</span>
          </button>
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-purple-500 to-blue-500 flex items-center justify-center text-xs font-bold border border-white/20">
            JD
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex flex-1 overflow-hidden">
        {/* Left Pane: Deals Table */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-background-dark">
          {/* Stage Tabs */}
          <div className="border-b border-border-dark bg-surface-dark/50 px-6 flex items-center gap-1 shrink-0">
            {(["All", "New", "Underwriting", "Credit", "Approved", "Closed"] as const).map((stage) => (
              <button
                key={stage}
                onClick={() => setStageFilter(stage)}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  stageFilter === stage
                    ? "border-primary text-primary"
                    : "border-transparent text-text-secondary hover:text-white"
                }`}
              >
                {stage} <span className="opacity-60">({stageCounts[stage]})</span>
              </button>
            ))}
          </div>

          {/* Filter Bar */}
          <div className="px-6 py-3 border-b border-border-dark flex items-center justify-between shrink-0 bg-surface-dark/30">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={blockersOnly}
                    onChange={(e) => setBlockersOnly(e.target.checked)}
                    className="sr-only toggle-checkbox"
                  />
                  <div
                    className={`w-10 h-5 rounded-full transition-colors ${
                      blockersOnly ? "bg-primary" : "bg-border-dark"
                    }`}
                  >
                    <div
                      className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
                        blockersOnly ? "translate-x-5" : "translate-x-0.5"
                      } mt-0.5`}
                    />
                  </div>
                </div>
                <span className="text-sm text-text-secondary">Only Blockers</span>
              </label>
            </div>
            <div className="text-xs text-text-secondary">
              Sort: <span className="text-white">Updated Recently</span>
            </div>
          </div>

          {/* Deals Table */}
          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface-dark border-b border-border-dark">
                <tr className="text-left text-xs text-text-secondary uppercase tracking-wide">
                  <th className="py-3 px-6 font-medium">Deal Name</th>
                  <th className="py-3 px-4 font-medium">Amount</th>
                  <th className="py-3 px-4 font-medium">Stage</th>
                  <th className="py-3 px-4 font-medium">Risk</th>
                  <th className="py-3 px-4 font-medium text-center">Prob</th>
                  <th className="py-3 px-4 font-medium">Lead</th>
                  <th className="py-3 px-4 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-dark">
                {filteredDeals.map((deal) => (
                  <tr
                    key={deal.id}
                    onClick={() => setSelectedId(deal.id)}
                    className={`cursor-pointer transition-colors hover:bg-white/5 ${
                      selectedId === deal.id ? "bg-white/10 border-l-4 border-l-primary" : ""
                    }`}
                  >
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-3">
                        {deal.blocker && (
                          <span
                            className={`material-symbols-outlined text-[18px] ${
                              deal.blocker === "critical" ? "text-red-500" : "text-amber-500"
                            }`}
                          >
                            {deal.blocker === "critical" ? "error" : "warning"}
                          </span>
                        )}
                        <div>
                          <div className="font-semibold text-white">{deal.name}</div>
                          <div className="text-xs text-text-secondary">{deal.subtitle}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-4 font-mono text-white">
                      ${(deal.amount / 1000000).toFixed(1)}M
                    </td>
                    <td className="py-4 px-4">
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-medium ${
                          deal.stage === "Approved"
                            ? "bg-emerald-500/20 text-emerald-400"
                            : deal.stage === "Credit"
                            ? "bg-purple-500/20 text-purple-400"
                            : deal.stage === "Underwriting"
                            ? "bg-blue-500/20 text-blue-400"
                            : deal.stage === "Closed"
                            ? "bg-gray-500/20 text-gray-400"
                            : "bg-amber-500/20 text-amber-400"
                        }`}
                      >
                        {deal.stage}
                      </span>
                    </td>
                    <td className="py-4 px-4">
                      <span
                        className={`font-mono text-sm ${
                          deal.riskRating.startsWith("A")
                            ? "text-emerald-400"
                            : deal.riskRating.startsWith("C")
                            ? "text-amber-400"
                            : "text-white"
                        }`}
                      >
                        {deal.riskRating}
                      </span>
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-xs font-mono">{deal.approvalProb}%</span>
                        <div className="w-12 h-1 bg-border-dark rounded-full overflow-hidden">
                          <div
                            className={`h-full ${
                              deal.approvalProb >= 80
                                ? "bg-emerald-500"
                                : deal.approvalProb >= 60
                                ? "bg-blue-500"
                                : "bg-amber-500"
                            }`}
                            style={{ width: `${deal.approvalProb}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold">
                          {deal.leadInitials}
                        </div>
                        <span className="text-xs text-text-secondary">{deal.leadName}</span>
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex flex-col">
                        <span className="text-xs text-white">{deal.updatedLabel}</span>
                        {deal.updatedNote && (
                          <span className="text-[10px] text-text-secondary">{deal.updatedNote}</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Pane: Deal Preview */}
        <aside className="w-[450px] 2xl:w-[500px] border-l border-border-dark bg-surface-dark flex flex-col overflow-hidden shrink-0">
          {/* Preview Header */}
          <div className="p-6 border-b border-border-dark shrink-0">
            <div className="flex items-start justify-between mb-4">
              <span
                className={`px-3 py-1 rounded-full text-xs font-medium ${
                  selectedDeal.stage === "Approved"
                    ? "bg-emerald-500/20 text-emerald-400"
                    : selectedDeal.stage === "Credit"
                    ? "bg-purple-500/20 text-purple-400"
                    : selectedDeal.stage === "Underwriting"
                    ? "bg-blue-500/20 text-blue-400"
                    : selectedDeal.stage === "Closed"
                    ? "bg-gray-500/20 text-gray-400"
                    : "bg-amber-500/20 text-amber-400"
                }`}
              >
                {selectedDeal.stage}
              </span>
              <button className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center text-text-secondary hover:text-white">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <h2 className="text-xl font-bold text-white mb-2">{selectedDeal.name}</h2>
            <p className="text-sm text-text-secondary mb-4">{selectedDeal.address || selectedDeal.subtitle}</p>

            {/* Mini Progress Bar */}
            <div className="flex items-center gap-2 mb-4">
              <div className="flex-1 h-1.5 bg-border-dark rounded-full overflow-hidden">
                <div
                  className={`h-full ${
                    selectedDeal.approvalProb >= 80
                      ? "bg-emerald-500"
                      : selectedDeal.approvalProb >= 60
                      ? "bg-blue-500"
                      : "bg-amber-500"
                  }`}
                  style={{ width: `${selectedDeal.approvalProb}%` }}
                />
              </div>
              <span className="text-xs font-mono text-text-secondary">{selectedDeal.approvalProb}%</span>
            </div>

            <button
              onClick={() => router.push("/underwriting")}
              className="w-full bg-primary hover:bg-primary/90 text-white font-semibold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-[20px]">open_in_new</span>
              Open Workspace
            </button>
          </div>

          {/* Preview Content - Scrollable */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Risk + Probability */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-text-secondary mb-1">Risk Rating</div>
                <div
                  className={`text-2xl font-bold ${
                    selectedDeal.riskRating.startsWith("A")
                      ? "text-emerald-400"
                      : selectedDeal.riskRating.startsWith("C")
                      ? "text-amber-400"
                      : "text-white"
                  }`}
                >
                  {selectedDeal.riskRating}
                </div>
              </div>
              <div>
                <div className="text-xs text-text-secondary mb-1">Approval Probability</div>
                <div className="text-2xl font-bold text-white">{selectedDeal.approvalProb}%</div>
              </div>
            </div>

            {/* Key Metrics */}
            <div>
              <h3 className="text-sm font-semibold text-white mb-3">Key Metrics Snapshot</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white/5 rounded-lg p-3 border border-border-dark">
                  <div className="text-xs text-text-secondary mb-1">Loan Amount</div>
                  <div className="text-lg font-bold text-white">
                    ${(selectedDeal.amount / 1000000).toFixed(1)}M
                  </div>
                </div>
                {selectedDeal.dscr && (
                  <div className="bg-white/5 rounded-lg p-3 border border-border-dark">
                    <div className="text-xs text-text-secondary mb-1">DSCR</div>
                    <div className="text-lg font-bold text-white">{selectedDeal.dscr}</div>
                  </div>
                )}
                {selectedDeal.ltv && (
                  <div className="bg-white/5 rounded-lg p-3 border border-border-dark">
                    <div className="text-xs text-text-secondary mb-1">LTV</div>
                    <div className="text-lg font-bold text-white">{selectedDeal.ltv}</div>
                  </div>
                )}
                {selectedDeal.debtYield && (
                  <div className="bg-white/5 rounded-lg p-3 border border-border-dark">
                    <div className="text-xs text-text-secondary mb-1">Debt Yield</div>
                    <div className="text-lg font-bold text-white">{selectedDeal.debtYield}</div>
                  </div>
                )}
              </div>
            </div>

            {/* Primary Risk Driver */}
            {selectedDeal.primaryRiskDriver && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="material-symbols-outlined text-red-500 text-[18px]">error</span>
                  <h3 className="text-sm font-semibold text-red-400">Primary Risk Driver</h3>
                </div>
                <p className="text-sm text-gray-300">{selectedDeal.primaryRiskDriver}</p>
              </div>
            )}

            {/* Next Best Action */}
            {selectedDeal.nextAction && (
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="material-symbols-outlined text-emerald-500 text-[18px]">lightbulb</span>
                  <h3 className="text-sm font-semibold text-emerald-400">Next Best Action</h3>
                </div>
                <p className="text-sm text-gray-300 mb-3">{selectedDeal.nextAction}</p>
                {selectedDeal.nextActionCta && (
                  <button className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-2 rounded-lg text-sm transition-colors">
                    {selectedDeal.nextActionCta}
                  </button>
                )}
              </div>
            )}

            {/* Document Status */}
            {selectedDeal.documents && (
              <div>
                <h3 className="text-sm font-semibold text-white mb-3">Document Status</h3>
                <div className="space-y-2">
                  {selectedDeal.documents.map((doc, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-2 bg-white/5 rounded border border-border-dark"
                    >
                      <span className="text-sm text-white">{doc.name}</span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded ${
                          doc.status === "complete"
                            ? "bg-emerald-500/20 text-emerald-400"
                            : doc.status === "pending"
                            ? "bg-amber-500/20 text-amber-400"
                            : "bg-red-500/20 text-red-400"
                        }`}
                      >
                        {doc.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Document Completeness Badge */}
            {selectedDeal.docCompleteness && (
              <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-border-dark">
                <span className="text-sm text-text-secondary">Document Completeness</span>
                <span className="text-sm font-bold text-white">
                  {selectedDeal.docCompleteness.done}/{selectedDeal.docCompleteness.total}
                </span>
              </div>
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}
