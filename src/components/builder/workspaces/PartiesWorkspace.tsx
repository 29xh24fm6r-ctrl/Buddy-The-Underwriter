"use client";

import { useState } from "react";
import type { BuilderState, BuilderPrefill, BorrowerCard, GuarantorCard, PartiesSectionData, GuarantorsSectionData, ExtractedOwnerCandidateSummary, BusinessSectionData } from "@/lib/builder/builderTypes";
import { OwnerDrawer } from "../drawers/OwnerDrawer";
import { GuarantorDrawer } from "../drawers/GuarantorDrawer";
import { EntityProfileDrawer } from "../drawers/EntityProfileDrawer";

type Props = {
  state: BuilderState;
  prefill: BuilderPrefill | null;
  onSectionChange: (sectionKey: string, data: Record<string, unknown>) => void;
  dealId: string;
};

const glass = "rounded-xl border border-white/10 bg-white/[0.03] p-4";

export function PartiesWorkspace({ state, prefill, onSectionChange, dealId }: Props) {
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

  const business = (state.sections.business ?? {}) as BusinessSectionData;

  function handleBusinessChange(field: string, value: string | boolean | number | undefined) {
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

          {/* Additional business details — DBA/EIN/phone/website/NAICS/employee count
              previously had no UI at all despite existing in BusinessSectionData,
              so Forms 1919/1244/148/etc. rendered these as null for any deal built
              purely through the builder. */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-white/50 mb-1 block">DBA</label>
              <input
                type="text"
                value={business.dba ?? ""}
                onChange={(e) => handleBusinessChange("dba", e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-white/25 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-white/50 mb-1 block">EIN / Tax ID</label>
              <input
                type="text"
                value={business.ein ?? ""}
                onChange={(e) => handleBusinessChange("ein", e.target.value)}
                placeholder="XX-XXXXXXX"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-white/25 focus:outline-none"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-white/50 mb-1 block">Phone</label>
              <input
                type="text"
                value={business.phone ?? ""}
                onChange={(e) => handleBusinessChange("phone", e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-white/25 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-white/50 mb-1 block">Web Address</label>
              <input
                type="text"
                value={business.website ?? ""}
                onChange={(e) => handleBusinessChange("website", e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-white/25 focus:outline-none"
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-white/50 mb-1 block">NAICS Code</label>
              <input
                type="text"
                value={business.naics_code ?? ""}
                onChange={(e) => handleBusinessChange("naics_code", e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-white/25 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-white/50 mb-1 block"># of Employees</label>
              <input
                type="number"
                value={business.employee_count != null ? String(business.employee_count) : ""}
                onChange={(e) => handleBusinessChange("employee_count", e.target.value ? Number(e.target.value) : undefined)}
                min={0}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-white/25 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-white/50 mb-1 block">DUNS Number</label>
              <input
                type="text"
                value={business.duns_number ?? ""}
                onChange={(e) => handleBusinessChange("duns_number", e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-white/25 focus:outline-none"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-white/50 mb-1 block">Contact Name</label>
              <input
                type="text"
                value={business.contact_name ?? ""}
                onChange={(e) => handleBusinessChange("contact_name", e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-white/25 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-white/50 mb-1 block">Contact Email</label>
              <input
                type="email"
                value={business.contact_email ?? ""}
                onChange={(e) => handleBusinessChange("contact_email", e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-white/25 focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-white/50 mb-1 block">Type of Business (Summary Description)</label>
            <input
              type="text"
              value={business.type_of_business ?? ""}
              onChange={(e) => handleBusinessChange("type_of_business", e.target.value)}
              placeholder="e.g. Metal fabrication"
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-white/25 focus:outline-none"
            />
          </div>

          {/* SBA 504/1244 compliance-history questions */}
          <div className="space-y-2 pt-1">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={business.has_affiliates ?? false}
                onChange={(e) => handleBusinessChange("has_affiliates", e.target.checked)}
                className="rounded border-white/15"
              />
              <label className="text-xs text-white/70">Applicant has affiliates</label>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={business.obtained_direct_or_guaranteed_loan ?? false}
                onChange={(e) => handleBusinessChange("obtained_direct_or_guaranteed_loan", e.target.checked)}
                className="rounded border-white/15"
              />
              <label className="text-xs text-white/70">Ever obtained/applied for a direct or guaranteed government loan</label>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={business.prior_application_submitted ?? false}
                onChange={(e) => handleBusinessChange("prior_application_submitted", e.target.checked)}
                className="rounded border-white/15"
              />
              <label className="text-xs text-white/70">Application for this project previously submitted to SBA</label>
            </div>
            {business.prior_application_submitted && (
              <div>
                <label className="text-xs text-white/50 mb-1 block">Prior CDC/Lender Name and Loan Program</label>
                <input
                  type="text"
                  value={business.prior_cdc_lender_name_and_program ?? ""}
                  onChange={(e) => handleBusinessChange("prior_cdc_lender_name_and_program", e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-white/25 focus:outline-none"
                />
              </div>
            )}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={business.has_bankruptcy_history ?? false}
                onChange={(e) => handleBusinessChange("has_bankruptcy_history", e.target.checked)}
                className="rounded border-white/15"
              />
              <label className="text-xs text-white/70">Applicant business has ever declared bankruptcy</label>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={business.has_pending_lawsuits ?? false}
                onChange={(e) => handleBusinessChange("has_pending_lawsuits", e.target.checked)}
                className="rounded border-white/15"
              />
              <label className="text-xs text-white/70">Applicant business involved in any pending lawsuits</label>
            </div>
          </div>

          {/* SBA 504 EPC/Operating Company structure */}
          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              checked={business.is_eligible_passive_company ?? false}
              onChange={(e) => handleBusinessChange("is_eligible_passive_company", e.target.checked)}
              className="rounded border-white/15"
            />
            <label className="text-xs text-white/70">
              Applicant is an Eligible Passive Company (EPC) — leases the project to a separate Operating Company (SBA 504)
            </label>
          </div>

          {business.is_eligible_passive_company && (
            <div className={`${glass} space-y-3`}>
              <div className="text-xs font-semibold text-white/80">Operating Company</div>
              <div>
                <label className="text-xs text-white/50 mb-1 block">Legal Name</label>
                <input
                  type="text"
                  value={business.operating_company_legal_name ?? ""}
                  onChange={(e) => handleBusinessChange("operating_company_legal_name", e.target.value)}
                  placeholder="Samaritus Operating Co LLC"
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-white/25 focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-white/50 mb-1 block">DBA</label>
                  <input
                    type="text"
                    value={business.operating_company_dba ?? ""}
                    onChange={(e) => handleBusinessChange("operating_company_dba", e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-white/25 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs text-white/50 mb-1 block">Legal Structure</label>
                  <input
                    type="text"
                    value={business.operating_company_legal_structure ?? ""}
                    onChange={(e) => handleBusinessChange("operating_company_legal_structure", e.target.value)}
                    placeholder="LLC"
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-white/25 focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-white/50 mb-1 block">Business Address</label>
                <input
                  type="text"
                  value={business.operating_company_address ?? ""}
                  onChange={(e) => handleBusinessChange("operating_company_address", e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-white/25 focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-white/50 mb-1 block">Tax ID</label>
                  <input
                    type="text"
                    value={business.operating_company_tax_id ?? ""}
                    onChange={(e) => handleBusinessChange("operating_company_tax_id", e.target.value)}
                    placeholder="XX-XXXXXXX"
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-white/25 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs text-white/50 mb-1 block">DUNS Number</label>
                  <input
                    type="text"
                    value={business.operating_company_duns_number ?? ""}
                    onChange={(e) => handleBusinessChange("operating_company_duns_number", e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-white/25 focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-white/50 mb-1 block">Contact Name</label>
                <input
                  type="text"
                  value={business.operating_company_contact_name ?? ""}
                  onChange={(e) => handleBusinessChange("operating_company_contact_name", e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-white/25 focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-white/50 mb-1 block">Email</label>
                  <input
                    type="email"
                    value={business.operating_company_email ?? ""}
                    onChange={(e) => handleBusinessChange("operating_company_email", e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-white/25 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs text-white/50 mb-1 block">Phone</label>
                  <input
                    type="text"
                    value={business.operating_company_phone ?? ""}
                    onChange={(e) => handleBusinessChange("operating_company_phone", e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-white/25 focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-white/50 mb-1 block">Web Address</label>
                <input
                  type="text"
                  value={business.operating_company_website ?? ""}
                  onChange={(e) => handleBusinessChange("operating_company_website", e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-white/25 focus:outline-none"
                />
              </div>
            </div>
          )}
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
        dealId={dealId}
      />
    </div>
  );
}
