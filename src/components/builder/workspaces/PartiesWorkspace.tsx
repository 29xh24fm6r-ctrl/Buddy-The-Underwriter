"use client";

import { useState } from "react";
import type { BuilderState, BuilderPrefill, BorrowerCard, GuarantorCard, PartiesSectionData, GuarantorsSectionData } from "@/lib/builder/builderTypes";
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

  const [ownerDrawer, setOwnerDrawer] = useState<{ open: boolean; owner: BorrowerCard | null }>({ open: false, owner: null });
  const [guarantorDrawer, setGuarantorDrawer] = useState<{ open: boolean; guarantor: GuarantorCard | null }>({ open: false, guarantor: null });
  const [profileDrawer, setProfileDrawer] = useState<{ open: boolean; owner: BorrowerCard | null }>({ open: false, owner: null });

  const totalPct = owners.reduce((s, o) => s + (o.ownership_pct ?? 0), 0);

  function handleOwnerSave(owner: BorrowerCard) {
    const idx = owners.findIndex((o) => o.id === owner.id);
    const next = [...owners];
    if (idx >= 0) next[idx] = owner;
    else next.push(owner);
    onSectionChange("parties", { owners: next });
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

      {owners.length === 0 ? (
        <div className={`${glass} text-center text-sm text-white/40`}>
          No owners added yet. Click &quot;Add Owner&quot; to get started.
        </div>
      ) : (
        <div className="space-y-2">
          {owners.map((owner) => (
            <div key={owner.id} className={`${glass} flex items-center justify-between cursor-pointer hover:bg-white/[0.05]`} onClick={() => setProfileDrawer({ open: true, owner })}>
              <div>
                <div className="text-sm font-medium text-white">{owner.full_legal_name || "Unnamed"}</div>
                <div className="text-xs text-white/50">
                  {owner.title ?? "No title"} &middot; {owner.ownership_pct != null ? `${owner.ownership_pct}%` : "No ownership %"}
                </div>
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
