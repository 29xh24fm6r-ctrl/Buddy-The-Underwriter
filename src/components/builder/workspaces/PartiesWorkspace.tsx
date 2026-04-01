"use client";

import { useState } from "react";
import type { BuilderState, BuilderPrefill, BorrowerCard, GuarantorCard, PartiesSectionData, GuarantorsSectionData, ExtractedOwnerCandidateSummary } from "@/lib/builder/builderTypes";
import { OwnerDrawer } from "../drawers/OwnerDrawer";
import { GuarantorDrawer } from "../drawers/GuarantorDrawer";
import { EntityProfileDrawer } from "../drawers/EntityProfileDrawer";

type Props = {
  state: BuilderState;
  prefill: BuilderPrefill | null;
  onSectionChange: (sectionKey: string, data: Record<string, unknown>) => void;
};

const glass = "rounded-xl border border-white/10 bg-white/[0.03] p-4";

export function PartiesWorkspace({ state, prefill, onSectionChange }: Props) {
  const parties = (state.sections.parties ?? { owners: [] }) as PartiesSectionData;
  const guarantorsSection = (state.sections.guarantors ?? { guarantors: [] }) as GuarantorsSectionData;
  const owners = parties.owners ?? [];
  const guarantors = guarantorsSection.guarantors ?? [];
  const candidates = prefill?.owner_candidates ?? [];

  const [ownerDrawer, setOwnerDrawer] = useState<{ open: boolean; owner: BorrowerCard | null }>({ open: false, owner: null });
  const [guarantorDrawer, setGuarantorDrawer] = useState<{ open: boolean; guarantor: GuarantorCard | null }>({ open: false, guarantor: null });
  const [profileDrawer, setProfileDrawer] = useState<{ open: boolean; owner: BorrowerCard | null }>({ open: false, owner: null });
  const [dismissedCandidates, setDismissedCandidates] = useState<Set<string>>(new Set());

  const totalPct = owners.reduce((s, o) => s + (o.ownership_pct ?? 0), 0);

  const business = (state.sections.business ?? {}) as {
    legal_entity_name?: string;
    entity_type?: string;
    state_of_formation?: string;
    business_address?: string;
    city?: string;
    state?: string;
    zip?: string;
  };

  function handleBusinessChange(field: string, value: string) {
    onSectionChange("business", { ...business, [field]: value });
  }

  // Filter candidates: exclude already-added owners and dismissed ones
  const ownerNames = new Set(owners.map((o) => o.full_legal_name?.toLowerCase().trim()).filter(Boolean));
  const visibleCandidates = candidates.filter(
    (c) =>
      !dismissedCandidates.has(c.temp_id) &&
      !ownerNames.has(c.full_legal_name?.toLowerCase().trim()),
  );

  function handleOwnerSave(owner: BorrowerCard) {
    const idx = owners.findIndex((o) => o.id === owner.id);
    const next = [...owners];
    if (idx >= 0) next[idx] = owner;
    else next.push(owner);
    onSectionChange("parties", { owners: next });
  }

  function handleAcceptCandidate(candidate: ExtractedOwnerCandidateSummary) {
    const card: BorrowerCard = {
      id: candidate.temp_id,
      full_legal_name: candidate.full_legal_name,
      ownership_pct: candidate.ownership_pct ?? undefined,
      title: candidate.title ?? undefined,
      home_address: candidate.home_address ?? undefined,
      home_city: candidate.home_city ?? undefined,
      home_state: candidate.home_state ?? undefined,
      home_zip: candidate.home_zip ?? undefined,
      prefill_source: {
        source_type: "business_tax_return",
        source_document_id: candidate.source_document_id,
        source_label: candidate.source_label,
        confidence: candidate.confidence,
      },
      prefill_status: "accepted",
    };
    onSectionChange("parties", { owners: [...owners, card] });
  }

  function handleDismissCandidate(tempId: string) {
    setDismissedCandidates((prev) => new Set(prev).add(tempId));
  }

  function handleGuarantorSave(g: GuarantorCard) {
    const idx = guarantors.findIndex((x) => x.id === g.id);
    const next = [...guarantors];
    if (idx >= 0) next[idx] = g;
    else next.push(g);
    onSectionChange("guarantors", { ...guarantorsSection, guarantors: next });
  }

  function handleNoGuarantors(checked: boolean) {
    onSectionChange("guarantors", { ...guarantorsSection, no_guarantors: checked });
  }

  return (
    <div className="space-y-4">
      {/* ── Business Entity ─────────────────────────────────────── */}
      <div className="border-b border-white/10 pb-4 mb-2">
        <div className="text-sm font-semibold text-white mb-3">Business Entity</div>
        <div className="grid grid-cols-1 gap-3">
          {/* Legal entity name */}
          <div>
            <label className="text-xs text-white/50 mb-1 block">Legal Entity Name</label>
            <input
              type="text"
              value={business.legal_entity_name ?? ""}
              onChange={(e) => handleBusinessChange("legal_entity_name", e.target.value)}
              placeholder="Samaritus Management LLC"
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-white/25 focus:outline-none"
            />
          </div>
          {/* Entity type + State of formation — side by side */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-white/50 mb-1 block">Entity Type</label>
              <select
                value={business.entity_type ?? ""}
                onChange={(e) => handleBusinessChange("entity_type", e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-white/25 focus:outline-none"
              >
                <option value="" className="bg-neutral-900 text-white">Select…</option>
                <option value="LLC" className="bg-neutral-900 text-white">LLC</option>
                <option value="S-Corp" className="bg-neutral-900 text-white">S-Corp</option>
                <option value="C-Corp" className="bg-neutral-900 text-white">C-Corp</option>
                <option value="Partnership" className="bg-neutral-900 text-white">Partnership</option>
                <option value="Sole Prop" className="bg-neutral-900 text-white">Sole Prop</option>
                <option value="Non-Profit" className="bg-neutral-900 text-white">Non-Profit</option>
                <option value="Other" className="bg-neutral-900 text-white">Other</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-white/50 mb-1 block">State of Formation</label>
              <input
                type="text"
                value={business.state_of_formation ?? ""}
                onChange={(e) => handleBusinessChange("state_of_formation", e.target.value)}
                placeholder="FL"
                maxLength={2}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-white/25 focus:outline-none"
              />
            </div>
          </div>
          {/* Business address */}
          <div>
            <label className="text-xs text-white/50 mb-1 block">Business Address</label>
            <input
              type="text"
              value={business.business_address ?? ""}
              onChange={(e) => handleBusinessChange("business_address", e.target.value)}
              placeholder="123 Main St"
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-white/25 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-1">
              <label className="text-xs text-white/50 mb-1 block">City</label>
              <input
                type="text"
                value={business.city ?? ""}
                onChange={(e) => handleBusinessChange("city", e.target.value)}
                placeholder="Miami"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-white/25 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-white/50 mb-1 block">State</label>
              <input
                type="text"
                value={business.state ?? ""}
                onChange={(e) => handleBusinessChange("state", e.target.value)}
                placeholder="FL"
                maxLength={2}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-white/25 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-white/50 mb-1 block">ZIP</label>
              <input
                type="text"
                value={business.zip ?? ""}
                onChange={(e) => handleBusinessChange("zip", e.target.value)}
                placeholder="33101"
                maxLength={10}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-white/25 focus:outline-none"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Owners */}
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-white">Owners / Principals</div>
        <button
          type="button"
          onClick={() => setOwnerDrawer({ open: true, owner: null })}
          className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/80 hover:bg-white/10"
        >
          + Add Owner
        </button>
      </div>

      {/* Suggested owner candidates from business tax returns */}
      {visibleCandidates.length > 0 && owners.length === 0 && (
        <div className="rounded-xl border border-blue-500/20 bg-blue-600/10 p-4 space-y-3">
          <div className="text-sm font-semibold text-blue-300">
            Buddy found {visibleCandidates.length} owner{visibleCandidates.length > 1 ? "s" : ""} from tax returns
          </div>
          <div className="text-xs text-blue-300/60">Review and accept to add to your deal.</div>
          <div className="space-y-2">
            {visibleCandidates.map((c) => (
              <div key={c.temp_id} className="flex items-center justify-between rounded-lg border border-blue-500/15 bg-white/[0.02] px-3 py-2">
                <div>
                  <div className="text-sm font-medium text-white">{c.full_legal_name || "Unnamed"}</div>
                  <div className="text-xs text-white/50">
                    {c.title ?? "No title"} &middot; {c.ownership_pct != null ? `${c.ownership_pct}%` : "No %"}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-blue-300/60 bg-blue-500/10 px-1.5 py-0.5 rounded-full">
                      Buddy found this
                    </span>
                    <span className="text-[10px] text-white/30">{c.source_label}</span>
                    {c.confidence < 0.80 && (
                      <span className="text-[10px] text-yellow-300/60">Low confidence</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleAcceptCandidate(c)}
                    className="rounded-lg bg-blue-600/20 border border-blue-500/30 px-3 py-1 text-xs font-semibold text-blue-200 hover:bg-blue-600/30"
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDismissCandidate(c.temp_id)}
                    className="text-xs text-white/40 hover:text-white/70"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {owners.length === 0 && visibleCandidates.length === 0 ? (
        <div className={`${glass} text-center text-sm text-white/40`}>
          No owners added yet. Click &quot;Add Owner&quot; to get started.
        </div>
      ) : (
        <div className="space-y-2">
          {owners.map((owner) => (
            <div key={owner.id} className={`${glass} flex items-center justify-between cursor-pointer hover:bg-white/[0.05]`} onClick={() => setProfileDrawer({ open: true, owner })}>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white">{owner.full_legal_name || "Unnamed"}</span>
                  {owner.prefill_source && (
                    <span className="text-[10px] text-blue-300/60 bg-blue-500/10 px-1.5 py-0.5 rounded-full">
                      {owner.prefill_status === "accepted" ? "Accepted" : owner.prefill_status === "edited" ? "Edited" : "Suggested"}
                    </span>
                  )}
                </div>
                <div className="text-xs text-white/50">
                  {owner.title ?? "No title"} &middot; {owner.ownership_pct != null ? `${owner.ownership_pct}%` : "No ownership %"}
                </div>
                {owner.prefill_source?.source_label && (
                  <div className="text-[10px] text-white/30 mt-0.5">Source: {owner.prefill_source.source_label}</div>
                )}
              </div>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setOwnerDrawer({ open: true, owner }); }}
                className="text-xs text-primary hover:underline"
              >
                Edit
              </button>
            </div>
          ))}
        </div>
      )}

      {owners.length > 0 && (
        <div className={`text-xs ${totalPct > 100 ? "text-rose-400" : "text-white/50"}`}>
          Total ownership: {totalPct}%{totalPct > 100 ? " (exceeds 100%)" : ""}
        </div>
      )}

      {/* Guarantors */}
      <div className="border-t border-white/10 pt-4 mt-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold text-white">Guarantors</div>
          <button
            type="button"
            onClick={() => setGuarantorDrawer({ open: true, guarantor: null })}
            disabled={guarantorsSection.no_guarantors}
            className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/80 hover:bg-white/10 disabled:opacity-40"
          >
            + Add Guarantor
          </button>
        </div>

        <div className="flex items-center gap-2 mb-3">
          <input
            type="checkbox"
            checked={guarantorsSection.no_guarantors ?? false}
            onChange={(e) => handleNoGuarantors(e.target.checked)}
            className="rounded border-white/15"
          />
          <label className="text-xs text-white/70">No personal guaranty required</label>
        </div>

        {!guarantorsSection.no_guarantors && guarantors.length > 0 && (
          <div className="space-y-2">
            {guarantors.map((g) => (
              <div key={g.id} className={`${glass} flex items-center justify-between`}>
                <div>
                  <div className="text-sm font-medium text-white">{g.full_legal_name || "Unnamed"}</div>
                  <div className="text-xs text-white/50 capitalize">{g.guaranty_type ?? "Not set"}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setGuarantorDrawer({ open: true, guarantor: g })}
                  className="text-xs text-primary hover:underline"
                >
                  Edit
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Drawers */}
      <OwnerDrawer
        open={ownerDrawer.open}
        onClose={() => setOwnerDrawer({ open: false, owner: null })}
        owner={ownerDrawer.owner}
        onSave={handleOwnerSave}
      />
      <GuarantorDrawer
        open={guarantorDrawer.open}
        onClose={() => setGuarantorDrawer({ open: false, guarantor: null })}
        guarantor={guarantorDrawer.guarantor}
        owners={owners}
        onSave={handleGuarantorSave}
      />
      <EntityProfileDrawer
        open={profileDrawer.open}
        onClose={() => setProfileDrawer({ open: false, owner: null })}
        owner={profileDrawer.owner}
      />
    </div>
  );
}
