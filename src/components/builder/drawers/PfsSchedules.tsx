"use client";

import { useEffect, useState } from "react";
import { BuilderField } from "../BuilderField";
import type { PfsNotePayable, PfsSecurity, PfsRealEstateProperty } from "@/lib/builder/builderTypes";

type Props = { dealId: string; ownershipEntityId?: string };

/**
 * Form 413 Sections 2-4 (notes payable, securities, real estate) — up to
 * 5/4/3 rows respectively, one set per 20%+ owner. Previously
 * borrower_pfs_notes_payable/securities/real_estate had no writer
 * anywhere (form413/inputBuilder.ts reads them, render.ts fills them, but
 * nothing ever created a row) — this is that writer.
 */
export function PfsSchedules({ dealId, ownershipEntityId }: Props) {
  if (!ownershipEntityId) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-white/40">
        Save this owner&apos;s name first — PFS schedules unlock once the owner is on file.
      </div>
    );
  }

  return (
    // Keyed by owner so switching owners remounts fresh (resets loading
    // state naturally) instead of an effect resetting it mid-flight.
    <div key={ownershipEntityId} className="space-y-4">
      <NotesPayableSection dealId={dealId} ownershipEntityId={ownershipEntityId} />
      <SecuritiesSection dealId={dealId} ownershipEntityId={ownershipEntityId} />
      <RealEstateSection dealId={dealId} ownershipEntityId={ownershipEntityId} />
    </div>
  );
}

type RowStatus = "loading" | "loaded" | "error";

/** Shared list/create/update/delete plumbing — the REST shape (GET list,
 * POST create, PATCH/DELETE by id) is identical across all three
 * schedules; only field sets and row caps differ. */
function usePfsRows<T extends { id: string }>(dealId: string, ownershipEntityId: string, resource: string) {
  const [items, setItems] = useState<T[]>([]);
  const [status, setStatus] = useState<RowStatus>("loading");

  useEffect(() => {
    let cancelled = false;
    // No synchronous setStatus("loading") here — the PfsSchedules parent
    // keys this whole subtree by ownershipEntityId, so a change in owner
    // remounts fresh (status already starts at "loading" via useState)
    // rather than needing an effect-driven reset.
    fetch(`/api/deals/${dealId}/builder/pfs/${resource}?ownershipEntityId=${ownershipEntityId}`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (json.items) {
          setItems(json.items);
          setStatus("loaded");
        } else {
          setStatus("error");
        }
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [dealId, ownershipEntityId, resource]);

  async function create(fields: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch(`/api/deals/${dealId}/builder/pfs/${resource}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownership_entity_id: ownershipEntityId, ...fields }),
    });
    const json = await res.json();
    if (res.ok && json.item) {
      setItems((prev) => [...prev, json.item]);
      return { ok: true };
    }
    return { ok: false, error: json.error ?? "Failed to add row." };
  }

  async function update(id: string, fields: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
    // item_id travels in the body, not a `[itemId]` path segment — this
    // whole schedule family is one route-slot-budget-conscious dispatcher
    // file (see the route's header comment).
    const res = await fetch(`/api/deals/${dealId}/builder/pfs/${resource}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item_id: id, ...fields }),
    });
    const json = await res.json();
    if (res.ok && json.item) {
      setItems((prev) => prev.map((i) => (i.id === id ? json.item : i)));
      return { ok: true };
    }
    return { ok: false, error: json.error ?? "Failed to save row." };
  }

  async function remove(id: string): Promise<void> {
    const res = await fetch(`/api/deals/${dealId}/builder/pfs/${resource}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item_id: id }),
    });
    if (res.ok) setItems((prev) => prev.filter((i) => i.id !== id));
  }

  return { items, status, create, update, remove };
}

function money(v: number | null | undefined): string {
  return v != null ? `$${Number(v).toLocaleString()}` : "—";
}

// ── Notes Payable (Section 2, up to 5 rows) ───────────────────────────────

const NOTE_FIELDS: Array<{ key: keyof PfsNotePayable; label: string; type?: "text" | "number" }> = [
  { key: "noteholder_name_address", label: "Noteholder name & address" },
  { key: "original_balance", label: "Original balance", type: "number" },
  { key: "current_balance", label: "Current balance", type: "number" },
  { key: "payment_amount", label: "Payment amount", type: "number" },
  { key: "payment_frequency", label: "Payment frequency (e.g. Monthly)" },
  { key: "collateral_description", label: "Collateral / terms" },
];

function NotesPayableSection({ dealId, ownershipEntityId }: { dealId: string; ownershipEntityId: string }) {
  const { items, status, create, update, remove } = usePfsRows<PfsNotePayable>(dealId, ownershipEntityId, "notes-payable");
  return (
    <ScheduleSection
      title="Notes Payable to Banks and Others"
      items={items}
      status={status}
      maxRows={5}
      fields={NOTE_FIELDS}
      renderSummary={(row) => `${row.noteholder_name_address || "Unnamed noteholder"} · ${money(row.current_balance)}`}
      onCreate={create}
      onUpdate={update}
      onDelete={remove}
    />
  );
}

// ── Securities (Section 3, up to 4 rows) ──────────────────────────────────

const SECURITY_FIELDS: Array<{ key: keyof PfsSecurity; label: string; type?: "text" | "number" }> = [
  { key: "number_of_shares", label: "Number of shares", type: "number" },
  { key: "name_of_securities", label: "Name of securities" },
  { key: "cost", label: "Cost", type: "number" },
  { key: "market_value_quotation_exchange", label: "Market value quotation / exchange" },
  { key: "date_of_quotation", label: "Date of quotation" },
  { key: "total_value", label: "Total value", type: "number" },
];

function SecuritiesSection({ dealId, ownershipEntityId }: { dealId: string; ownershipEntityId: string }) {
  const { items, status, create, update, remove } = usePfsRows<PfsSecurity>(dealId, ownershipEntityId, "securities");
  return (
    <ScheduleSection
      title="Stocks and Bonds"
      items={items}
      status={status}
      maxRows={4}
      fields={SECURITY_FIELDS}
      renderSummary={(row) => `${row.name_of_securities || "Unnamed security"} · ${money(row.total_value)}`}
      onCreate={create}
      onUpdate={update}
      onDelete={remove}
    />
  );
}

// ── Real Estate (Section 4, up to 3 properties A/B/C) ─────────────────────

const REAL_ESTATE_FIELDS: Array<{ key: keyof PfsRealEstateProperty; label: string; type?: "text" | "number" }> = [
  { key: "property_type", label: "Property type" },
  { key: "address", label: "Address" },
  { key: "date_purchased", label: "Date purchased" },
  { key: "original_cost", label: "Original cost", type: "number" },
  { key: "present_market_value", label: "Present market value", type: "number" },
  { key: "mortgage_holder_name_address", label: "Mortgage holder name & address" },
  { key: "mortgage_account_number", label: "Mortgage account number" },
  { key: "mortgage_balance", label: "Mortgage balance", type: "number" },
  { key: "mortgage_payment_per_month_year", label: "Mortgage payment (per mo./yr.)" },
  { key: "mortgage_status", label: "Status (e.g. Current)" },
];

function RealEstateSection({ dealId, ownershipEntityId }: { dealId: string; ownershipEntityId: string }) {
  const { items, status, create, update, remove } = usePfsRows<PfsRealEstateProperty>(dealId, ownershipEntityId, "real-estate");
  return (
    <ScheduleSection
      title="Real Estate Owned"
      items={items}
      status={status}
      maxRows={3}
      fields={REAL_ESTATE_FIELDS}
      renderSummary={(row) => `Property ${row.property_label} · ${row.address || "No address"} · ${money(row.present_market_value)}`}
      onCreate={create}
      onUpdate={update}
      onDelete={remove}
    />
  );
}

// ── Shared repeater UI ─────────────────────────────────────────────────────

type FieldSpec<T> = { key: keyof T; label: string; type?: "text" | "number" };

function ScheduleSection<T extends { id: string }>({
  title,
  items,
  status,
  maxRows,
  fields,
  renderSummary,
  onCreate,
  onUpdate,
  onDelete,
}: {
  title: string;
  items: T[];
  status: RowStatus;
  maxRows: number;
  fields: FieldSpec<T>[];
  renderSummary: (row: T) => string;
  onCreate: (fields: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
  onUpdate: (id: string, fields: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function startAdd() {
    setDraft({});
    setError(null);
    setEditingId("new");
  }

  function startEdit(row: T) {
    setDraft({ ...row });
    setError(null);
    setEditingId(row.id);
  }

  function cancel() {
    setEditingId(null);
    setDraft({});
    setError(null);
  }

  async function save() {
    setSaving(true);
    setError(null);
    const result = editingId === "new" ? await onCreate(draft) : await onUpdate(editingId as string, draft);
    setSaving(false);
    if (result.ok) {
      cancel();
    } else {
      setError(result.error ?? "Failed to save.");
    }
  }

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold text-white/70">{title}</div>
        {editingId === null && items.length < maxRows && (
          <button type="button" onClick={startAdd} className="text-xs text-primary hover:underline">
            + Add row
          </button>
        )}
      </div>

      {status === "loading" && <div className="text-xs text-white/40">Loading…</div>}
      {status === "error" && <div className="text-xs text-rose-400">Couldn&apos;t load this schedule.</div>}

      {status === "loaded" && items.length === 0 && editingId === null && (
        <div className="text-xs text-white/30">No rows yet.</div>
      )}

      {status === "loaded" && (
        <div className="space-y-1.5">
          {items.map((row) =>
            editingId === row.id ? (
              <RowForm key={row.id} fields={fields} draft={draft} setDraft={setDraft} error={error} saving={saving} onSave={save} onCancel={cancel} />
            ) : (
              <div key={row.id} className="flex items-center justify-between rounded-md border border-white/5 bg-white/[0.02] px-2 py-1.5">
                <span className="text-xs text-white/80">{renderSummary(row)}</span>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => startEdit(row)} className="text-[11px] text-primary hover:underline">
                    Edit
                  </button>
                  <button type="button" onClick={() => onDelete(row.id)} className="text-[11px] text-rose-400 hover:text-rose-300">
                    Delete
                  </button>
                </div>
              </div>
            ),
          )}
          {editingId === "new" && (
            <RowForm fields={fields} draft={draft} setDraft={setDraft} error={error} saving={saving} onSave={save} onCancel={cancel} />
          )}
        </div>
      )}
    </div>
  );
}

function RowForm<T>({
  fields,
  draft,
  setDraft,
  error,
  saving,
  onSave,
  onCancel,
}: {
  fields: FieldSpec<T>[];
  draft: Record<string, unknown>;
  setDraft: (d: Record<string, unknown>) => void;
  error: string | null;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] p-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        {fields.map((f) => (
          <BuilderField
            key={String(f.key)}
            label={f.label}
            type={f.type ?? "text"}
            value={draft[f.key as string] != null ? String(draft[f.key as string]) : ""}
            onChange={(v) => setDraft({ ...draft, [f.key as string]: f.type === "number" ? (v ? Number(v) : null) : v || null })}
          />
        ))}
      </div>
      {error && <div className="text-xs text-rose-400">{error}</div>}
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-white/70 hover:bg-white/5">
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
