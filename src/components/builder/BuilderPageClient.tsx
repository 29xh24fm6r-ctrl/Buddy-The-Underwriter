"use client";

import { useState, useRef, useEffect } from "react";
import type {
  BuilderState,
  BuilderStepKey,
  BuilderSectionKey,
  BuilderPrefill,
  BuilderReadiness,
  ServerFlags,
  CollateralItem,
  ProceedsItem,
  DealSectionData,
} from "@/lib/builder/builderTypes";
import { computeStepCompletions } from "@/lib/builder/builderCompletion";
import { computeBuilderReadiness } from "@/lib/builder/builderReadiness";
import { BuilderHeader } from "./BuilderHeader";
import { BuilderWorkflowRail } from "./BuilderWorkflowRail";
import { BuilderWorkspace } from "./BuilderWorkspace";
import { BuilderRightRail } from "./BuilderRightRail";

type Props = {
  dealId: string;
  dealName: string;
  stage: string | null;
  initialSections: Record<string, { data: unknown; updated_at: string }>;
  initialCollateral: CollateralItem[];
  initialProceeds: ProceedsItem[];
  prefill: BuilderPrefill | null;
  serverFlags: ServerFlags;
};

function mergeWithPrefill(
  sections: Record<string, Record<string, unknown>>,
  prefill: BuilderPrefill | null,
): Record<string, Record<string, unknown>> {
  if (!prefill) return sections;

  const merged = { ...sections };

  // Merge deal
  if (prefill.deal && Object.keys(prefill.deal).length > 0) {
    const existing = (merged.deal ?? {}) as Record<string, unknown>;
    const newDeal: Record<string, unknown> = { ...existing };
    for (const [k, v] of Object.entries(prefill.deal)) {
      if (newDeal[k] == null || newDeal[k] === "") {
        newDeal[k] = v;
      }
    }
    merged.deal = newDeal;
  }

  // Merge business
  if (prefill.business && Object.keys(prefill.business).length > 0) {
    const existing = (merged.business ?? {}) as Record<string, unknown>;
    const newBiz: Record<string, unknown> = { ...existing };
    for (const [k, v] of Object.entries(prefill.business)) {
      if (newBiz[k] == null || newBiz[k] === "") {
        newBiz[k] = v;
      }
    }
    merged.business = newBiz;
  }

  // Merge parties (owners from prefill if no existing owners)
  if (prefill.owners && prefill.owners.length > 0) {
    const existing = merged.parties as { owners?: unknown[] } | undefined;
    if (!existing?.owners || existing.owners.length === 0) {
      merged.parties = { owners: prefill.owners };
    }
  }

  // Merge story
  if (prefill.story && Object.keys(prefill.story).length > 0) {
    const existing = (merged.story ?? {}) as Record<string, unknown>;
    const newStory: Record<string, unknown> = { ...existing };
    for (const [k, v] of Object.entries(prefill.story)) {
      if (newStory[k] == null || newStory[k] === "") {
        newStory[k] = v;
      }
    }
    merged.story = newStory;
  }

  return merged;
}

export default function BuilderPageClient({
  dealId,
  dealName,
  stage,
  initialSections,
  initialCollateral,
  initialProceeds,
  prefill,
  serverFlags,
}: Props) {
  // Convert initial sections into mutable state
  const rawSections: Record<string, Record<string, unknown>> = {};
  for (const [key, val] of Object.entries(initialSections)) {
    rawSections[key] = val.data as Record<string, unknown>;
  }
  const mergedSections = mergeWithPrefill(rawSections, prefill);

  const [sections, setSections] = useState<Record<string, Record<string, unknown>>>(mergedSections);
  const [collateral, setCollateral] = useState<CollateralItem[]>(initialCollateral);
  const [proceeds, setProceeds] = useState<ProceedsItem[]>(initialProceeds);
  const [activeStep, setActiveStep] = useState<BuilderStepKey>("overview");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  const debounceRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Build current state object
  const readiness = computeBuilderReadiness(
    { sections, collateral, proceeds, prefill, readiness: { credit_ready: false, credit_ready_with_exceptions: false, credit_ready_pct: 0, credit_ready_blockers: [], doc_ready: false, doc_ready_pct: 0, doc_ready_blockers: [], policy_exceptions: [] }, activeStep, saveState, lastSaved },
    serverFlags,
  );

  const state: BuilderState = {
    sections,
    collateral,
    proceeds,
    prefill,
    readiness,
    activeStep,
    saveState,
    lastSaved,
  };

  const steps = computeStepCompletions(state, serverFlags);

  // Raw (non-debounced) section persist. Plain hoisted function
  // declaration rather than a useCallback const — it calls itself for the
  // parties owner-id follow-up persist below, and a self-reference from
  // inside a `const x = useCallback(...)` initializer trips
  // react-hooks' TDZ check even though the recursive call only ever fires
  // async, well after the binding exists. Not passed to any child as a
  // prop, so it doesn't need useCallback's referential stability.
  async function persistSection(sectionKey: string, data: Record<string, unknown>) {
    try {
      const res = await fetch(`/api/deals/${dealId}/builder/sections`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section_key: sectionKey, data }),
      });
      const json = await res.json();
      if (res.ok && json.ok) {
        setSaveState("saved");
        setLastSaved(json.updated_at);
        // Learn the real ownership_entities.id for each owner — the
        // client-side draft id is synthetic (crypto.randomUUID()) until
        // the canonical write-through resolves/creates the row. Needed
        // before the SSN capture UI can call the PII vault endpoint,
        // which requires a real ownership_entity_id.
        const ownerEntityIds = json.ownerEntityIds as Array<{ id: string; ownership_entity_id: string }> | undefined;
        if (sectionKey === "parties" && ownerEntityIds?.length) {
          const idById = new Map(ownerEntityIds.map((m) => [m.id, m.ownership_entity_id]));
          const prevOwners = ((data as { owners?: Array<{ id: string; ownership_entity_id?: string }> }).owners ?? []);
          let changed = false;
          const nextOwners = prevOwners.map((o) => {
            if (idById.has(o.id) && o.ownership_entity_id !== idById.get(o.id)) {
              changed = true;
              return { ...o, ownership_entity_id: idById.get(o.id) };
            }
            return o;
          });
          if (changed) {
            setSections((prev) => ({ ...prev, parties: { ...(prev.parties ?? {}), owners: nextOwners } }));
            // Persist the resolved IDs — otherwise they're only in memory
            // until the next unrelated parties save. Safe to call from
            // here: writePartiesCanonical is idempotent, so this
            // round-trip returns matching IDs and doesn't loop further.
            persistSection("parties", { ...(data as Record<string, unknown>), owners: nextOwners });
          }
        }
      } else {
        setSaveState("error");
      }
    } catch {
      setSaveState("error");
    }
  }

  // Debounced section save
  function saveSection(sectionKey: string, data: Record<string, unknown>) {
    const existing = debounceRef.current.get(sectionKey);
    if (existing) clearTimeout(existing);
    setSaveState("saving");
    const timer = setTimeout(() => { persistSection(sectionKey, data); }, 500);
    debounceRef.current.set(sectionKey, timer);
  }

  function handleSectionChange(sectionKey: string, data: Record<string, unknown>) {
    setSections((prev) => ({ ...prev, [sectionKey]: data }));
    saveSection(sectionKey, data);
  }

  // Collateral handlers (immediate, not debounced)
  async function handleCollateralAdd(item: Omit<CollateralItem, "id" | "deal_id" | "created_at" | "updated_at">) {
    try {
      const res = await fetch(`/api/deals/${dealId}/builder/collateral`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item),
      });
      const json = await res.json();
      if (res.ok && json.item) {
        setCollateral((prev) => [...prev, json.item]);
        setSaveState("saved");
        setLastSaved(new Date().toISOString());
      }
    } catch {
      setSaveState("error");
    }
  }

  async function handleCollateralUpdate(id: string, updates: Partial<CollateralItem>) {
    try {
      const res = await fetch(`/api/deals/${dealId}/builder/collateral/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const json = await res.json();
      if (res.ok && json.item) {
        setCollateral((prev) => prev.map((c) => (c.id === id ? json.item : c)));
        setSaveState("saved");
        setLastSaved(new Date().toISOString());
      }
    } catch {
      setSaveState("error");
    }
  }

  async function handleCollateralDelete(id: string) {
    try {
      await fetch(`/api/deals/${dealId}/builder/collateral/${id}`, { method: "DELETE" });
      setCollateral((prev) => prev.filter((c) => c.id !== id));
      setSaveState("saved");
      setLastSaved(new Date().toISOString());
    } catch {
      setSaveState("error");
    }
  }

  // Proceeds handlers (immediate)
  async function handleProceedsAdd(item: Omit<ProceedsItem, "id" | "deal_id" | "created_at">) {
    try {
      const res = await fetch(`/api/deals/${dealId}/builder/proceeds`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item),
      });
      const json = await res.json();
      if (res.ok && json.item) {
        setProceeds((prev) => [...prev, json.item]);
        setSaveState("saved");
        setLastSaved(new Date().toISOString());
      }
    } catch {
      setSaveState("error");
    }
  }

  async function handleProceedsDelete(id: string) {
    try {
      await fetch(`/api/deals/${dealId}/builder/proceeds/${id}`, { method: "DELETE" });
      setProceeds((prev) => prev.filter((p) => p.id !== id));
      setSaveState("saved");
      setLastSaved(new Date().toISOString());
    } catch {
      setSaveState("error");
    }
  }

  const deal = sections.deal as Partial<DealSectionData> | undefined;

  return (
    <div className="mx-auto max-w-[1600px] px-3 py-4 space-y-4 sm:px-6 sm:py-6">
      <BuilderHeader
        dealId={dealId}
        dealName={dealName}
        loanType={(deal?.loan_type as any) ?? null}
        requestedAmount={deal?.requested_amount ?? null}
        stage={stage}
        readiness={readiness}
      />

      <BuilderWorkflowRail
        steps={steps}
        activeStep={activeStep}
        onStepClick={setActiveStep}
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">
        <div className="lg:col-span-8">
          <BuilderWorkspace
            activeStep={activeStep}
            state={state}
            serverFlags={serverFlags}
            prefill={prefill}
            dealId={dealId}
            dealName={dealName}
            onSectionChange={handleSectionChange}
            onCollateralAdd={handleCollateralAdd}
            onCollateralUpdate={handleCollateralUpdate}
            onCollateralDelete={handleCollateralDelete}
            onProceedsAdd={handleProceedsAdd}
            onProceedsDelete={handleProceedsDelete}
            onStepNavigate={setActiveStep}
          />
        </div>
        <div className="lg:col-span-4">
          <BuilderRightRail
            readiness={readiness}
            saveState={saveState}
            lastSaved={lastSaved}
          />
        </div>
      </div>
    </div>
  );
}
