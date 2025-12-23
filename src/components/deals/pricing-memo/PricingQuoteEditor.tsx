"use client";

import { useState } from "react";

type PricingQuote = {
  id: string;
  quote: any;
  assumptions: any;
  status: string;
  created_at: string;
};

export function PricingQuoteEditor({
  dealId,
  snapshotId,
  riskFactsId,
  quote,
  onCreated,
  onUpdated,
}: {
  dealId: string;
  snapshotId: string | null;
  riskFactsId: string | null;
  quote: PricingQuote | null;
  onCreated: (quote: PricingQuote) => void;
  onUpdated: (quote: PricingQuote) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [formData, setFormData] = useState(quote?.quote ?? {});

  const handleCreate = async () => {
    if (!snapshotId || !riskFactsId) {
      alert("Please generate risk facts first");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/pricing-quotes/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshotId, riskFactsId }),
      });

      if (!res.ok) throw new Error("Failed to create quote");

      const data = await res.json();
      onCreated(data.pricing_quote);
      setFormData(data.pricing_quote.quote);
    } catch (error) {
      console.error("Error creating quote:", error);
      alert("Failed to create quote");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!quote) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/pricing-quotes/${quote.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quote: formData }),
      });

      if (!res.ok) throw new Error("Failed to update quote");

      const data = await res.json();
      onUpdated(data.pricing_quote);
      setEditing(false);
    } catch (error) {
      console.error("Error updating quote:", error);
      alert("Failed to update quote");
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (status: string) => {
    if (!quote) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/pricing-quotes/${quote.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });

      if (!res.ok) throw new Error("Failed to update status");

      const data = await res.json();
      onUpdated(data.pricing_quote);
    } catch (error) {
      console.error("Error updating status:", error);
      alert("Failed to update status");
    } finally {
      setLoading(false);
    }
  };

  if (!quote) {
    return (
      <div className="rounded-lg border border-white/10 bg-black/50 p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">Pricing Quote</h3>
          <button
            onClick={handleCreate}
            disabled={loading || !riskFactsId}
            className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Creating..." : "Create Draft from Facts"}
          </button>
        </div>
        <p className="mt-2 text-sm text-gray-400">
          No pricing quote yet. Generate risk facts first, then create a draft quote.
        </p>
      </div>
    );
  }

  const q = quote.quote;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold text-white">Pricing Quote</h3>
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              quote.status === "proposed"
                ? "bg-green-500/20 text-green-300"
                : quote.status === "sent"
                ? "bg-blue-500/20 text-blue-300"
                : "bg-gray-500/20 text-gray-300"
            }`}
          >
            {quote.status}
          </span>
        </div>
        <div className="flex gap-2">
          {!editing ? (
            <>
              <button
                onClick={() => setEditing(true)}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Edit
              </button>
              {quote.status === "draft" && (
                <button
                  onClick={() => handleStatusChange("proposed")}
                  disabled={loading}
                  className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Mark Proposed
                </button>
              )}
            </>
          ) : (
            <>
              <button
                onClick={handleSave}
                disabled={loading}
                className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Saving..." : "Save Draft"}
              </button>
              <button
                onClick={() => {
                  setEditing(false);
                  setFormData(quote.quote);
                }}
                className="rounded-md bg-gray-600 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Rate Section */}
        <div className="rounded-lg border border-white/10 bg-black/30 p-4">
          <h4 className="mb-3 text-sm font-medium text-white">Rate Structure</h4>
          <div className="space-y-3">
            <Field
              label="All-In Rate"
              value={`${(q.rate?.all_in_rate * 100).toFixed(2)}%`}
              editing={editing}
              onChange={(val) =>
                setFormData({
                  ...formData,
                  rate: { ...formData.rate, all_in_rate: parseFloat(val) / 100 },
                })
              }
            />
            <Field
              label="Margin (bps)"
              value={q.rate?.margin_bps?.toString() ?? "0"}
              editing={editing}
              onChange={(val) =>
                setFormData({
                  ...formData,
                  rate: { ...formData.rate, margin_bps: parseInt(val) },
                })
              }
            />
            <Field
              label="Index"
              value={q.rate?.index ?? "SOFR"}
              editing={editing}
              onChange={(val) =>
                setFormData({
                  ...formData,
                  rate: { ...formData.rate, index: val },
                })
              }
            />
          </div>
        </div>

        {/* Fees Section */}
        <div className="rounded-lg border border-white/10 bg-black/30 p-4">
          <h4 className="mb-3 text-sm font-medium text-white">Fees</h4>
          <div className="space-y-3">
            <Field
              label="Origination"
              value={formatCurrency(q.fees?.origination ?? 0)}
              editing={editing}
              onChange={(val) =>
                setFormData({
                  ...formData,
                  fees: { ...formData.fees, origination: parseFloat(val.replace(/[^0-9.-]/g, "")) },
                })
              }
            />
            <Field
              label="Underwriting"
              value={formatCurrency(q.fees?.underwriting ?? 0)}
              editing={editing}
              onChange={(val) =>
                setFormData({
                  ...formData,
                  fees: { ...formData.fees, underwriting: parseFloat(val.replace(/[^0-9.-]/g, "")) },
                })
              }
            />
            <Field
              label="Legal"
              value={formatCurrency(q.fees?.legal ?? 0)}
              editing={editing}
              onChange={(val) =>
                setFormData({
                  ...formData,
                  fees: { ...formData.fees, legal: parseFloat(val.replace(/[^0-9.-]/g, "")) },
                })
              }
            />
          </div>
        </div>
      </div>

      {/* Rationale */}
      <div className="rounded-lg border border-white/10 bg-black/30 p-4">
        <h4 className="mb-2 text-sm font-medium text-white">Rationale</h4>
        {editing ? (
          <textarea
            value={formData.rationale ?? ""}
            onChange={(e) => setFormData({ ...formData, rationale: e.target.value })}
            rows={3}
            className="w-full rounded-md border border-white/10 bg-black/50 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        ) : (
          <p className="text-sm text-gray-300">{q.rationale ?? "No rationale provided"}</p>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  editing,
  onChange,
}: {
  label: string;
  value: string;
  editing: boolean;
  onChange?: (value: string) => void;
}) {
  return (
    <div>
      <label className="text-xs text-gray-400">{label}</label>
      {editing && onChange ? (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 w-full rounded-md border border-white/10 bg-black/50 px-2 py-1 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      ) : (
        <div className="mt-1 text-sm font-medium text-white">{value}</div>
      )}
    </div>
  );
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}
