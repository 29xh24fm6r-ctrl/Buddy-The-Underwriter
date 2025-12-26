"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase/client";
import { SnapshotPicker } from "@/components/deals/pricing-memo/SnapshotPicker";
import { RiskFactsCard } from "@/components/deals/pricing-memo/RiskFactsCard";
import { PricingQuoteEditor } from "@/components/deals/pricing-memo/PricingQuoteEditor";
import { MemoGenerator } from "@/components/deals/pricing-memo/MemoGenerator";
import { OutputsList } from "@/components/deals/pricing-memo/OutputsList";

type Tab = "snapshot" | "facts" | "quote" | "memo" | "outputs";

export default function PricingMemoPage({ params }: { params: { dealId: string } }) {
  const { dealId } = params;
  
  const [activeTab, setActiveTab] = useState<Tab>("snapshot");
  const [loading, setLoading] = useState(true);
  
  // Data state
  const [dealName, setDealName] = useState<string>("Loading...");
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null);
  const [riskFacts, setRiskFacts] = useState<any | null>(null);
  const [pricingQuote, setPricingQuote] = useState<any | null>(null);
  const [generatedDocs, setGeneratedDocs] = useState<any[]>([]);

  // Load initial data
  useEffect(() => {
    loadInitialData();
  }, [dealId]);

  const loadInitialData = async () => {
    setLoading(true);
    try {
      // Load deal
      const { data: deal } = await supabase
        .from("deals")
        .select("name")
        .eq("id", dealId)
        .single();

      if (deal) setDealName(deal.name);

      // Load snapshots
      const { data: snaps } = await supabase
        .from("deal_context_snapshots")
        .select("id, version, created_at, context")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false });

      if (snaps && snaps.length > 0) {
        setSnapshots(snaps);
        setSelectedSnapshotId(snaps[0].id);
        
        // Load risk facts for latest snapshot
        await loadRiskFacts(snaps[0].id);
      }

      // Load generated documents
      await loadGeneratedDocs();
    } catch (error) {
      console.error("Error loading data:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadRiskFacts = async (snapshotId: string) => {
    const { data } = await supabase
      .from("risk_facts")
      .select("*")
      .eq("snapshot_id", snapshotId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    setRiskFacts(data);

    // Load pricing quote if facts exist
    if (data) {
      const { data: quote } = await supabase
        .from("pricing_quotes")
        .select("*")
        .eq("risk_facts_id", data.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      setPricingQuote(quote);
    }
  };

  const loadGeneratedDocs = async () => {
    const { data } = await supabase
      .from("generated_documents")
      .select("*")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false });

    if (data) setGeneratedDocs(data);
  };

  const handleSnapshotChange = (snapshotId: string) => {
    setSelectedSnapshotId(snapshotId);
    loadRiskFacts(snapshotId);
  };

  const handleRiskFactsGenerated = (facts: any) => {
    setRiskFacts(facts);
    setPricingQuote(null); // Reset quote when facts change
    setActiveTab("facts");
  };

  const handleQuoteCreated = (quote: any) => {
    setPricingQuote(quote);
    setActiveTab("quote");
  };

  const handleQuoteUpdated = (quote: any) => {
    setPricingQuote(quote);
  };

  const handleMemoGenerated = (doc: any) => {
    setGeneratedDocs([doc, ...generatedDocs]);
    loadGeneratedDocs(); // Refresh full list
  };

  const tabs: Array<{ id: Tab; label: string; badge?: number }> = [
    { id: "snapshot", label: "Snapshot" },
    { id: "facts", label: "Risk Facts", badge: riskFacts ? 1 : 0 },
    { id: "quote", label: "Pricing Quote", badge: pricingQuote ? 1 : 0 },
    { id: "memo", label: "Memo Generator" },
    { id: "outputs", label: "Outputs", badge: generatedDocs.length },
  ];

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
        <div className="text-white">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black">
      {/* Header */}
      <div className="border-b border-white/10 bg-black/70 backdrop-blur-sm">
        <div className="mx-auto max-w-7xl px-6 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white">Pricing + Memo</h1>
              <p className="mt-1 text-sm text-gray-400">{dealName}</p>
            </div>
            <div className="flex gap-2">
              {selectedSnapshotId && (
                <span className="rounded-full bg-blue-500/20 px-3 py-1 text-xs font-medium text-blue-300">
                  v{snapshots.find(s => s.id === selectedSnapshotId)?.version ?? "?"}
                </span>
              )}
              {riskFacts && (
                <span className="rounded-full bg-green-500/20 px-3 py-1 text-xs font-medium text-green-300">
                  Facts Ready
                </span>
              )}
              {pricingQuote && (
                <span className="rounded-full bg-purple-500/20 px-3 py-1 text-xs font-medium text-purple-300">
                  Quote {pricingQuote.status}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-6">
        <div className="flex gap-6">
          {/* Left Rail - Tabs */}
          <div className="w-64 flex-shrink-0">
            <nav className="sticky top-6 space-y-1 rounded-lg border border-white/10 bg-black/50 p-2 backdrop-blur-sm">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm font-medium transition-colors ${
                    activeTab === tab.id
                      ? "bg-blue-600 text-white"
                      : "text-gray-300 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <span>{tab.label}</span>
                  {tab.badge !== undefined && tab.badge > 0 && (
                    <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs">
                      {tab.badge}
                    </span>
                  )}
                </button>
              ))}
            </nav>
          </div>

          {/* Main Panel */}
          <div className="flex-1">
            <div className="rounded-lg border border-white/10 bg-black/50 p-6 backdrop-blur-sm">
              {activeTab === "snapshot" && (
                <div className="space-y-6">
                  <SnapshotPicker
                    snapshots={snapshots}
                    selectedId={selectedSnapshotId}
                    onSelect={handleSnapshotChange}
                  />
                  
                  {selectedSnapshotId && (
                    <div className="rounded-lg border border-white/10 bg-black/30 p-4">
                      <h4 className="mb-2 text-sm font-medium text-white">Snapshot Context</h4>
                      <pre className="max-h-96 overflow-auto text-xs text-gray-400">
                        {JSON.stringify(
                          snapshots.find(s => s.id === selectedSnapshotId)?.context,
                          null,
                          2
                        )}
                      </pre>
                    </div>
                  )}
                </div>
              )}

              {activeTab === "facts" && (
                <RiskFactsCard
                  dealId={dealId}
                  snapshotId={selectedSnapshotId}
                  riskFacts={riskFacts}
                  onGenerated={handleRiskFactsGenerated}
                />
              )}

              {activeTab === "quote" && (
                <PricingQuoteEditor
                  dealId={dealId}
                  snapshotId={selectedSnapshotId}
                  riskFactsId={riskFacts?.id ?? null}
                  quote={pricingQuote}
                  onCreated={handleQuoteCreated}
                  onUpdated={handleQuoteUpdated}
                />
              )}

              {activeTab === "memo" && (
                <MemoGenerator
                  dealId={dealId}
                  snapshotId={selectedSnapshotId}
                  riskFactsId={riskFacts?.id ?? null}
                  pricingQuoteId={pricingQuote?.id ?? null}
                  documents={generatedDocs.filter(d => d.doc_type === "credit_memo")}
                  onGenerated={handleMemoGenerated}
                />
              )}

              {activeTab === "outputs" && (
                <OutputsList dealId={dealId} documents={generatedDocs} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* LEGACY STITCH IMPLEMENTATION - Kept for reference
const LEGACY_STITCH_BODY_HTML = `<!-- 1. Global Header -->
<header class="h-14 shrink-0 border-b border-[#282f39] bg-[#111418] flex items-center justify-between px-6 z-20">
<!-- Left: Branding & Deal Context -->
<div class="flex items-center gap-6">
<div class="flex items-center gap-3">
<div class="size-6 text-primary">
<svg fill="none" viewbox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
<path d="M42.4379 44C42.4379 44 36.0744 33.9038 41.1692 24C46.8624 12.9336 42.2078 4 42.2078 4L7.01134 4C7.01134 4 11.6577 12.932 5.96912 23.9969C0.876273 33.9029 7.27094 44 7.27094 44L42.4379 44Z" fill="currentColor"></path>
</svg>
</div>
<h1 class="text-white text-base font-bold tracking-tight">Buddy <span class="text-text-dim font-normal">| The Underwriter</span></h1>
</div>
<div class="h-6 w-px bg-[#282f39]"></div>
<div class="flex items-center gap-4">
<span class="text-sm font-medium text-white">1500 Broadway - Refinance</span>
<!-- Status Pills -->
<div class="flex gap-2">
<div class="flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20">
<span class="material-symbols-outlined text-emerald-500 text-[14px]">check_circle</span>
<span class="text-[11px] font-medium text-emerald-500 uppercase tracking-wide">Snapshot: Latest</span>
</div>
<div class="flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20">
<span class="material-symbols-outlined text-emerald-500 text-[14px]">shield</span>
<span class="text-[11px] font-medium text-emerald-500 uppercase tracking-wide">Risk: Current</span>
</div>
<div class="flex items-center gap-1.5 px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20">
<span class="material-symbols-outlined text-amber-500 text-[14px]">edit_note</span>
<span class="text-[11px] font-medium text-amber-500 uppercase tracking-wide">Pricing: Draft</span>
</div>
</div>
</div>
</div>
<!-- Right: Actions -->
<div class="flex items-center gap-4">
<div class="flex gap-2">
<button class="flex h-8 items-center gap-2 px-3 bg-[#136dec] hover:bg-primary-dark transition-colors rounded text-white text-xs font-semibold tracking-wide">
<span class="material-symbols-outlined text-[16px]">add_a_photo</span>
                    New Snapshot
                </button>
<button class="flex h-8 items-center gap-2 px-3 bg-[#282f39] hover:bg-[#333b47] transition-colors rounded text-white text-xs font-semibold tracking-wide border border-[#3b4554]">
<span class="material-symbols-outlined text-[16px]">refresh</span>
                    Regen Risk Facts
                </button>
</div>
<div class="h-8 w-8 rounded-full bg-cover bg-center border border-[#3b4554] cursor-pointer relative" data-alt="User profile avatar placeholder showing a generic silhouette" style="background-image: url('https://lh3.googleusercontent.com/aida-public/AB6AXuB8cg2jvg1NvClGGEk1hOD9SA42JdX4MRrF43Qo7iH3O8MUPQQ5in4bct1BtgsOtrk7QSDluiRTSSmEMH3RCc8OUDJ5QrP9AAi3ga1xyg-WwLszgyS5w9NpYbld79gbXY95fK4TpPHDi4gVITe0xC8brSMFbTv0OP9X2wz7gbKhEiySJgNFSKrlHX6OXTnHb44bgKz8v7B7ZQBcaok7CyBLkJqcb9v7wQxX-gr1cQL9TccuMRshaZsZ75OVRbluaA4w8WOZVLpzIv4');">
<div class="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-500 border-2 border-[#111418]"></div>
</div>
</div>
</header>
<!-- Main Layout Container -->
<div class="flex flex-1 overflow-hidden">
<!-- 2. Left Navigation Rail -->
<nav class="w-16 shrink-0 bg-[#111418] border-r border-[#282f39] flex flex-col items-center py-4 gap-6 z-10">
<div class="flex flex-col items-center gap-6 w-full">
<button class="group relative flex flex-col items-center justify-center gap-1 text-text-dim hover:text-white transition-colors w-full py-2">
<span class="material-symbols-outlined text-[24px]">camera_alt</span>
<span class="text-[10px] font-medium opacity-0 group-hover:opacity-100 absolute top-8 transition-opacity bg-black px-1 rounded">Snapshot</span>
</button>
<button class="group relative flex flex-col items-center justify-center gap-1 text-text-dim hover:text-white transition-colors w-full py-2">
<span class="material-symbols-outlined text-[24px]">shield_person</span>
</button>
<!-- Active State -->
<button class="relative flex flex-col items-center justify-center gap-1 text-primary w-full py-2">
<div class="absolute left-0 top-1/2 -translate-y-1/2 h-8 w-1 bg-primary rounded-r"></div>
<span class="material-symbols-outlined text-[24px] fill-current">currency_exchange</span>
</button>
<button class="group relative flex flex-col items-center justify-center gap-1 text-text-dim hover:text-white transition-colors w-full py-2">
<span class="material-symbols-outlined text-[24px]">description</span>
</button>
<button class="group relative flex flex-col items-center justify-center gap-1 text-text-dim hover:text-white transition-colors w-full py-2">
<span class="material-symbols-outlined text-[24px]">folder_open</span>
</button>
</div>
</nav>
<!-- Main Content Area -->
<main class="flex flex-1 overflow-hidden">
<!-- LEFT PANEL: Data & Controls (60%) -->
<div class="w-[60%] flex flex-col border-r border-[#282f39] bg-[#0B0E14] overflow-y-auto custom-scrollbar">
<!-- Section A: Snapshot Context -->
<section class="p-6 border-b border-[#282f39] bg-[#151B26]/30">
<div class="flex items-center justify-between mb-3">
<div class="flex items-center gap-2">
<span class="material-symbols-outlined text-primary text-[20px]">visibility</span>
<h2 class="text-sm font-bold uppercase tracking-wider text-white">Deal Context Snapshot</h2>
</div>
<span class="text-xs text-text-dim font-mono bg-[#282f39] px-2 py-0.5 rounded">ID: SNAP-8821</span>
</div>
<div class="bg-[#151B26] border border-[#282f39] rounded p-4 relative group">
<div class="flex justify-between items-start mb-2 border-b border-[#282f39] pb-2">
<div class="text-xs text-text-dim">Source: <span class="text-white">OM_Nov2023.pdf</span> • Created: <span class="text-white">Today, 09:15 AM</span></div>
<button class="text-xs text-primary hover:text-white font-medium transition-colors">View Source</button>
</div>
<div class="h-20 overflow-y-auto custom-scrollbar text-sm text-gray-300 leading-relaxed font-light">
                            The subject property is a Class A office building located in the Times Square submarket of Manhattan. 
                            Built in 1998 and renovated in 2018, the 32-story tower comprises 450,000 RSF. 
                            Major tenants include TechCorp (35% NRA) and LawFirm LLP (20% NRA). 
                            The sponsor seeks a $45M refinance of the existing senior debt maturing in Dec 2024.
                            Preliminary valuation suggests an as-is value of $72.5M based on a 6.5% cap rate.
                        </div>
<div class="absolute bottom-2 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
<button class="bg-primary/20 hover:bg-primary/40 text-primary hover:text-white text-xs font-semibold px-3 py-1.5 rounded border border-primary/30 backdrop-blur-sm">Use This Context</button>
</div>
</div>
</section>
<!-- Section B: Risk Facts -->
<section class="p-6 border-b border-[#282f39]">
<div class="flex items-center justify-between mb-4">
<h2 class="text-sm font-bold uppercase tracking-wider text-white flex items-center gap-2">
<span class="material-symbols-outlined text-emerald-500 text-[18px]">verified</span>
                            Normalized Risk Facts
                        </h2>
<span class="text-[10px] text-text-dim">Derived from Snapshot #8821</span>
</div>
<div class="grid grid-cols-3 gap-3">
<!-- Metric Card -->
<div class="bg-[#151B26] border border-[#2d3646] p-3 rounded flex flex-col gap-1 relative overflow-hidden group hover:border-primary/50 transition-colors">
<div class="flex justify-between items-start">
<span class="text-[11px] text-text-dim font-medium uppercase tracking-wide">LTV</span>
<div class="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.6)]" title="High Confidence"></div>
</div>
<div class="text-xl font-bold font-mono tracking-tight text-white">62.0%</div>
</div>
<div class="bg-[#151B26] border border-[#2d3646] p-3 rounded flex flex-col gap-1 relative overflow-hidden group hover:border-primary/50 transition-colors">
<div class="flex justify-between items-start">
<span class="text-[11px] text-text-dim font-medium uppercase tracking-wide">DSCR</span>
<div class="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.6)]"></div>
</div>
<div class="text-xl font-bold font-mono tracking-tight text-white">1.35x</div>
</div>
<div class="bg-[#151B26] border border-[#2d3646] p-3 rounded flex flex-col gap-1 relative overflow-hidden group hover:border-primary/50 transition-colors">
<div class="flex justify-between items-start">
<span class="text-[11px] text-text-dim font-medium uppercase tracking-wide">NOI</span>
<div class="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.6)]"></div>
</div>
<div class="text-xl font-bold font-mono tracking-tight text-white">$4.2M</div>
</div>
<div class="bg-[#151B26] border border-[#2d3646] p-3 rounded flex flex-col gap-1 relative overflow-hidden group hover:border-primary/50 transition-colors">
<div class="flex justify-between items-start">
<span class="text-[11px] text-text-dim font-medium uppercase tracking-wide">Loan Amount</span>
<div class="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.6)]"></div>
</div>
<div class="text-xl font-bold font-mono tracking-tight text-white">$45.0M</div>
</div>
<div class="bg-[#151B26] border border-[#2d3646] p-3 rounded flex flex-col gap-1 relative overflow-hidden group hover:border-primary/50 transition-colors">
<div class="flex justify-between items-start">
<span class="text-[11px] text-text-dim font-medium uppercase tracking-wide">As-Is Value</span>
<div class="h-1.5 w-1.5 rounded-full bg-amber-500 shadow-[0_0_4px_rgba(245,158,11,0.6)]" title="Medium Confidence"></div>
</div>
<div class="text-xl font-bold font-mono tracking-tight text-white">$72.5M</div>
</div>
<div class="bg-[#151B26] border border-[#2d3646] p-3 rounded flex flex-col gap-1 relative overflow-hidden group hover:border-primary/50 transition-colors">
<div class="flex justify-between items-start">
<span class="text-[11px] text-text-dim font-medium uppercase tracking-wide">Recourse</span>
<div class="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.6)]"></div>
</div>
<div class="text-xl font-bold font-mono tracking-tight text-white">Non-Recourse</div>
</div>
</div>
</section>
<!-- Section C: Pricing Quote Writer -->
<section class="p-6 flex-1">
<div class="flex items-center justify-between mb-6">
<h2 class="text-sm font-bold uppercase tracking-wider text-white flex items-center gap-2">
<span class="material-symbols-outlined text-primary text-[18px]">tune</span>
                            Pricing Quote <span class="text-amber-500 normal-case bg-amber-500/10 px-1.5 py-0.5 rounded text-[10px] ml-2 font-medium tracking-normal border border-amber-500/20">Draft</span>
</h2>
<div class="flex gap-2">
<button class="text-xs text-text-dim hover:text-white px-3 py-1.5 rounded bg-[#282f39] border border-[#3b4554] transition-colors">Reset to Risk Facts</button>
</div>
</div>
<div class="space-y-6">
<!-- Group 1: Loan Structure -->
<div class="bg-[#151B26] rounded border border-[#2d3646] p-4">
<div class="text-[11px] text-text-dim uppercase font-semibold mb-3 tracking-wider flex items-center gap-2">
<span class="w-1 h-3 bg-primary rounded-full"></span>
                                Loan Structure
                            </div>
<div class="grid grid-cols-2 gap-4">
<div class="flex flex-col gap-1">
<label class="text-[11px] text-gray-400">Product Type</label>
<select class="bg-[#0B0E14] border border-[#2d3646] text-white text-sm rounded h-8 px-2 focus:ring-1 focus:ring-primary focus:border-primary outline-none">
<option>Senior Secured</option>
<option>Mezzanine</option>
<option>Preferred Equity</option>
</select>
</div>
<div class="flex flex-col gap-1">
<label class="text-[11px] text-gray-400">Term (Months)</label>
<input class="bg-[#0B0E14] border border-[#2d3646] text-white text-sm rounded h-8 px-2 focus:ring-1 focus:ring-primary focus:border-primary outline-none font-mono" type="text" value="36"/>
</div>
<div class="flex flex-col gap-1">
<label class="text-[11px] text-gray-400">Amortization</label>
<select class="bg-[#0B0E14] border border-[#2d3646] text-white text-sm rounded h-8 px-2 focus:ring-1 focus:ring-primary focus:border-primary outline-none">
<option>Interest Only</option>
<option>30-Year Schedule</option>
</select>
</div>
<div class="flex flex-col gap-1">
<label class="text-[11px] text-gray-400">Exit Fee</label>
<div class="flex items-center bg-[#0B0E14] border border-[#2d3646] rounded h-8 px-2 focus-within:border-primary">
<input class="bg-transparent text-white text-sm outline-none w-full font-mono" type="text" value="1.00"/>
<span class="text-xs text-text-dim">%</span>
</div>
</div>
</div>
</div>
<!-- Group 2: Pricing Engine -->
<div class="bg-[#151B26] rounded border border-[#2d3646] p-4 relative overflow-hidden">
<div class="absolute right-0 top-0 w-32 h-32 bg-primary/5 rounded-bl-full pointer-events-none"></div>
<div class="text-[11px] text-text-dim uppercase font-semibold mb-3 tracking-wider flex items-center gap-2">
<span class="w-1 h-3 bg-primary rounded-full"></span>
                                Rate Calculator
                            </div>
<div class="flex items-end gap-3">
<div class="flex-1 flex flex-col gap-1">
<label class="text-[11px] text-gray-400">Index (SOFR)</label>
<div class="flex items-center bg-[#0B0E14] border border-[#2d3646] rounded h-10 px-3">
<input class="bg-transparent text-white text-sm outline-none w-full font-mono font-medium" type="text" value="5.32"/>
<span class="text-xs text-text-dim">%</span>
</div>
</div>
<div class="text-text-dim pb-3 font-light text-xl">+</div>
<div class="flex-1 flex flex-col gap-1">
<label class="text-[11px] text-gray-400">Spread (bps)</label>
<div class="flex items-center bg-[#0B0E14] border border-[#2d3646] rounded h-10 px-3">
<input class="bg-transparent text-white text-sm outline-none w-full font-mono font-medium" type="text" value="325"/>
<span class="text-xs text-text-dim">bps</span>
</div>
</div>
<div class="text-text-dim pb-3 font-light text-xl">=</div>
<div class="flex-1 flex flex-col gap-1">
<label class="text-[11px] text-primary font-bold">All-in Rate</label>
<div class="flex items-center bg-primary/10 border border-primary/40 rounded h-10 px-3">
<span class="text-primary text-lg font-bold font-mono">8.57%</span>
</div>
</div>
</div>
</div>
<!-- Group 3: Rationale -->
<div class="bg-[#151B26] rounded border border-[#2d3646] p-4">
<div class="text-[11px] text-text-dim uppercase font-semibold mb-3 tracking-wider flex items-center gap-2">
<span class="w-1 h-3 bg-primary rounded-full"></span>
                                Credit Rationale
                            </div>
<textarea class="w-full bg-[#0B0E14] border border-[#2d3646] text-white text-sm rounded p-3 h-24 focus:ring-1 focus:ring-primary focus:border-primary outline-none resize-none" placeholder="Enter credit rationale and pricing justification here...">Pricing is supported by strong historical occupancy (94% avg last 3 years) and sponsorship's liquidity position ($12M). The spread of 325 bps reflects current market volatility but remains competitive for Class A assets in this submarket.</textarea>
</div>
</div>
<div class="mt-8 flex justify-end gap-3 pb-8">
<button class="px-4 py-2 bg-[#282f39] hover:bg-[#333b47] border border-[#3b4554] rounded text-white text-sm font-medium transition-colors">Save Draft</button>
<button class="px-4 py-2 bg-primary hover:bg-primary-dark rounded text-white text-sm font-medium shadow-lg shadow-primary/20 transition-colors flex items-center gap-2">
<span class="material-symbols-outlined text-[18px]">send</span>
                            Mark as Proposed
                        </button>
</div>
</section>
</div>
<!-- RIGHT PANEL: Output & Intelligence (40%) -->
<div class="w-[40%] flex flex-col bg-[#111418] border-l border-[#282f39]">
<!-- Section D: Quote Preview -->
<section class="p-6 border-b border-[#282f39] flex-shrink-0">
<div class="flex items-center justify-between mb-4">
<h2 class="text-sm font-bold uppercase tracking-wider text-white flex items-center gap-2">
<span class="material-symbols-outlined text-white text-[18px]">preview</span>
                            Live Preview
                        </h2>
</div>
<!-- Paper Card Style -->
<div class="bg-[#f0f0f0] rounded text-[#111418] p-5 shadow-2xl relative overflow-hidden" data-alt="Light colored card resembling a paper document preview">
<div class="flex justify-between items-start mb-4 border-b border-gray-300 pb-2">
<div>
<h3 class="font-bold text-lg leading-tight">Indicative Term Sheet</h3>
<p class="text-[10px] text-gray-500 font-mono mt-1">REF: 1500-BDWY-REF</p>
</div>
<div class="text-right">
<div class="text-2xl font-bold tracking-tight text-[#136dec]">8.57%</div>
<div class="text-[10px] uppercase font-bold text-gray-500">Fixed Rate Equivalent</div>
</div>
</div>
<div class="space-y-3">
<div class="grid grid-cols-2 gap-y-2 text-xs">
<div class="text-gray-500">Loan Amount</div>
<div class="font-bold text-right">$45,000,000</div>
<div class="text-gray-500">LTV / DSCR</div>
<div class="font-bold text-right">62% / 1.35x</div>
<div class="text-gray-500">Term</div>
<div class="font-bold text-right">36 Months (IO)</div>
</div>
<div class="mt-4 pt-3 border-t border-gray-300">
<h4 class="text-[10px] uppercase font-bold text-gray-500 mb-1">Risk Factors &amp; Mitigants</h4>
<ul class="list-disc list-outside ml-3 text-[10px] leading-tight text-gray-700 space-y-1">
<li>Tenant concentration (TechCorp 35%) mitigated by long-term lease (exp 2030).</li>
<li>Market vacancy rising; property outperforms submarket by 400bps.</li>
</ul>
</div>
</div>
</div>
</section>
<!-- Section E: Memo Generator -->
<section class="flex-1 p-6 flex flex-col min-h-0">
<div class="flex items-center justify-between mb-4">
<h2 class="text-sm font-bold uppercase tracking-wider text-white flex items-center gap-2">
<span class="material-symbols-outlined text-white text-[18px]">article</span>
                            Memo Generator
                        </h2>
<span class="text-[10px] text-text-dim">Based on Proposed Pricing</span>
</div>
<div class="flex-1 bg-[#0B0E14] border border-[#2d3646] rounded p-1 overflow-y-auto custom-scrollbar mb-4">
<!-- Checklist Item -->
<div class="flex items-center justify-between p-3 border-b border-[#282f39] hover:bg-[#151B26] transition-colors group">
<div class="flex items-center gap-3">
<span class="material-symbols-outlined text-emerald-500 text-[18px]">check_circle</span>
<span class="text-sm font-medium text-gray-200">Executive Summary</span>
</div>
<span class="text-[10px] text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">Ready</span>
</div>
<div class="flex items-center justify-between p-3 border-b border-[#282f39] hover:bg-[#151B26] transition-colors group">
<div class="flex items-center gap-3">
<span class="material-symbols-outlined text-emerald-500 text-[18px]">check_circle</span>
<span class="text-sm font-medium text-gray-200">Transaction Overview</span>
</div>
<span class="text-[10px] text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">Ready</span>
</div>
<div class="flex items-center justify-between p-3 border-b border-[#282f39] hover:bg-[#151B26] transition-colors group">
<div class="flex items-center gap-3">
<span class="material-symbols-outlined text-text-dim text-[18px]">radio_button_unchecked</span>
<span class="text-sm font-medium text-gray-400">Financial Analysis</span>
</div>
<span class="text-[10px] text-text-dim bg-[#282f39] px-1.5 py-0.5 rounded">Pending</span>
</div>
<div class="flex items-center justify-between p-3 border-b border-[#282f39] hover:bg-[#151B26] transition-colors group">
<div class="flex items-center gap-3">
<span class="material-symbols-outlined text-text-dim text-[18px]">radio_button_unchecked</span>
<span class="text-sm font-medium text-gray-400">Risk Factors</span>
</div>
<span class="text-[10px] text-text-dim bg-[#282f39] px-1.5 py-0.5 rounded">Pending</span>
</div>
<div class="flex items-center justify-between p-3 hover:bg-[#151B26] transition-colors group">
<div class="flex items-center gap-3">
<span class="material-symbols-outlined text-text-dim text-[18px]">radio_button_unchecked</span>
<span class="text-sm font-medium text-gray-400">Appendix &amp; Maps</span>
</div>
<span class="text-[10px] text-text-dim bg-[#282f39] px-1.5 py-0.5 rounded">Pending</span>
</div>
</div>
<button class="w-full py-3 bg-primary hover:bg-primary-dark rounded text-white text-sm font-bold shadow-lg shadow-primary/20 transition-all flex items-center justify-center gap-2 mb-6">
<span class="material-symbols-outlined text-[20px] animate-spin hidden">sync</span> <!-- Hidden spinner state -->
<span class="material-symbols-outlined text-[20px]">bolt</span>
                        Generate Full Credit Memo
                    </button>
<!-- Section F: Generated Outputs -->
<div>
<h3 class="text-[11px] font-bold uppercase tracking-wider text-text-dim mb-3">Output History</h3>
<div class="space-y-2">
<div class="flex items-center justify-between p-2 rounded bg-[#151B26] border border-[#2d3646] hover:border-primary/40 transition-colors group cursor-pointer">
<div class="flex items-center gap-3">
<div class="h-8 w-8 rounded bg-red-500/10 flex items-center justify-center text-red-500">
<span class="material-symbols-outlined text-[18px]">picture_as_pdf</span>
</div>
<div class="flex flex-col">
<span class="text-xs font-medium text-white group-hover:text-primary transition-colors">Pricing_Summary_v2.pdf</span>
<span class="text-[10px] text-text-dim">Today, 10:42 AM • 2.4 MB</span>
</div>
</div>
<span class="material-symbols-outlined text-text-dim hover:text-white text-[18px]">download</span>
</div>
<div class="flex items-center justify-between p-2 rounded bg-[#151B26] border border-[#2d3646] hover:border-primary/40 transition-colors group cursor-pointer">
<div class="flex items-center gap-3">
<div class="h-8 w-8 rounded bg-blue-500/10 flex items-center justify-center text-blue-500">
<span class="material-symbols-outlined text-[18px]">description</span>
</div>
<div class="flex flex-col">
<span class="text-xs font-medium text-white group-hover:text-primary transition-colors">Draft_Memo_v1.0.docx</span>
<span class="text-[10px] text-text-dim">Yesterday, 4:15 PM • 850 KB</span>
</div>
</div>
<span class="material-symbols-outlined text-text-dim hover:text-white text-[18px]">download</span>
</div>
</div>
</div>
</section>
</div>
</main>
</div>`;

export default function Page() {
  return (
    <StitchFrame
      title={TITLE}
      fontLinks={FONT_LINKS}
      tailwindCdnSrc={TAILWIND_CDN}
*/
