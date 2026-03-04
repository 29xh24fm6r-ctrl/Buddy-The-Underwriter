"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Entity = {
  id: string;
  name: string;
  legal_name: string | null;
  ein: string | null;
  entity_kind: string;
};

type Slot = {
  id: string;
  slot_key: string;
  required_doc_type: string;
  required_entity_id: string | null;
  sort_order: number;
};

type BindingsData = {
  entities: Entity[];
  entity_scoped_slots: Slot[];
  unbound_count: number;
  entity_binding_required: boolean;
};

export default function EntitySlotBindingPage({ dealId }: { dealId: string }) {
  const [data, setData] = useState<BindingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Local binding state: slotId → entityId
  const [localBindings, setLocalBindings] = useState<Record<string, string>>({});

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/intake/entity-slot-bindings`);
      const json = await res.json();
      if (!json.ok) {
        setError(json.error || "Failed to load bindings");
        return;
      }
      setData(json);
      // Initialize local bindings from current state
      const initial: Record<string, string> = {};
      for (const slot of json.entity_scoped_slots ?? []) {
        if (slot.required_entity_id) {
          initial[slot.id] = slot.required_entity_id;
        }
      }
      setLocalBindings(initial);
    } catch {
      setError("Failed to load entity slot bindings");
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleBindingChange = (slotId: string, entityId: string) => {
    setLocalBindings((prev) => {
      if (!entityId) {
        const next = { ...prev };
        delete next[slotId];
        return next;
      }
      return { ...prev, [slotId]: entityId };
    });
    setSaveResult(null);
  };

  const handleSave = async () => {
    if (!data) return;

    // Collect bindings that changed from current server state
    const changedBindings: Array<{ slotId: string; entityId: string }> = [];
    for (const slot of data.entity_scoped_slots) {
      const newEntityId = localBindings[slot.id];
      if (newEntityId && newEntityId !== slot.required_entity_id) {
        changedBindings.push({ slotId: slot.id, entityId: newEntityId });
      }
    }

    if (changedBindings.length === 0) {
      setSaveResult({ ok: true, message: "No changes to save." });
      return;
    }

    setSaving(true);
    setSaveResult(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/intake/bind-slots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bindings: changedBindings }),
      });
      const json = await res.json();
      if (!json.ok) {
        setSaveResult({ ok: false, message: json.error || "Failed to save bindings" });
        return;
      }
      setSaveResult({
        ok: true,
        message: `Bound ${json.bound_count} slot(s). ${json.unbound_count} unbound remaining.`,
      });
      // Refresh data from server
      await fetchData();
    } catch {
      setSaveResult({ ok: false, message: "Network error saving bindings" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-neutral-400">
        Loading entity slot bindings...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">
        {error}
      </div>
    );
  }

  if (!data) return null;

  const { entities, entity_scoped_slots: slots, unbound_count } = data;

  const unboundSlots = slots.filter((s) => !s.required_entity_id);
  const boundSlots = slots.filter((s) => !!s.required_entity_id);

  // Check if there are unsaved changes
  const hasChanges = slots.some((slot) => {
    const local = localBindings[slot.id];
    return local && local !== slot.required_entity_id;
  });

  // All slots bound?
  const allBound = unbound_count === 0 && unboundSlots.length === 0;

  const entityLabel = (entityId: string) => {
    const ent = entities.find((e) => e.id === entityId);
    if (!ent) return entityId;
    return `${ent.name} (${ent.entity_kind})`;
  };

  const docTypeLabel = (dt: string) =>
    dt.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Entity Slot Bindings</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Assign each entity-scoped document slot to the correct entity.
          </p>
        </div>
        <Link
          href={`/deals/${dealId}`}
          className="text-sm text-blue-600 hover:text-blue-800"
        >
          Back to Deal
        </Link>
      </div>

      {/* Summary banner */}
      {allBound ? (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          All entity-scoped slots are bound. Auto-matching can proceed.
        </div>
      ) : (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {unbound_count} unbound slot{unbound_count !== 1 ? "s" : ""} remaining.
          Bind all slots to enable auto-matching for entity-scoped documents.
        </div>
      )}

      {entities.length === 0 && (
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
          No entities registered for this deal. Add entities first before binding slots.
        </div>
      )}

      {/* Unbound slots table */}
      {unboundSlots.length > 0 && (
        <section className="rounded-xl border border-neutral-200 bg-white shadow-sm">
          <div className="border-b border-neutral-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-neutral-900">
              Unbound Slots ({unboundSlots.length})
            </h2>
          </div>
          <div className="divide-y divide-neutral-100">
            {unboundSlots.map((slot) => (
              <div
                key={slot.id}
                className="flex items-center justify-between gap-4 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-neutral-900">
                    {slot.slot_key}
                  </div>
                  <div className="text-xs text-neutral-500">
                    {docTypeLabel(slot.required_doc_type)}
                  </div>
                </div>
                <select
                  className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
                  value={localBindings[slot.id] ?? ""}
                  onChange={(e) => handleBindingChange(slot.id, e.target.value)}
                >
                  <option value="">Select entity...</option>
                  {entities.map((ent) => (
                    <option key={ent.id} value={ent.id}>
                      {ent.name} ({ent.entity_kind})
                      {ent.ein ? ` - ${ent.ein}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Bound slots table */}
      {boundSlots.length > 0 && (
        <section className="rounded-xl border border-neutral-200 bg-white shadow-sm">
          <div className="border-b border-neutral-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-neutral-900">
              Bound Slots ({boundSlots.length})
            </h2>
          </div>
          <div className="divide-y divide-neutral-100">
            {boundSlots.map((slot) => (
              <div
                key={slot.id}
                className="flex items-center justify-between gap-4 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-neutral-900">
                    {slot.slot_key}
                  </div>
                  <div className="text-xs text-neutral-500">
                    {docTypeLabel(slot.required_doc_type)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
                    value={localBindings[slot.id] ?? slot.required_entity_id ?? ""}
                    onChange={(e) => handleBindingChange(slot.id, e.target.value)}
                  >
                    <option value="">Select entity...</option>
                    {entities.map((ent) => (
                      <option key={ent.id} value={ent.id}>
                        {ent.name} ({ent.entity_kind})
                        {ent.ein ? ` - ${ent.ein}` : ""}
                      </option>
                    ))}
                  </select>
                  <span className="text-xs text-green-600">Bound</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Save button + result */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleSave}
          disabled={saving || !hasChanges}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? "Saving..." : "Save Bindings"}
        </button>
        {saveResult && (
          <span
            className={`text-sm ${saveResult.ok ? "text-green-600" : "text-red-600"}`}
          >
            {saveResult.message}
          </span>
        )}
      </div>
    </div>
  );
}
