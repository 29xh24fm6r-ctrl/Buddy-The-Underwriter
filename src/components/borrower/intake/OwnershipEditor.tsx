"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Borrower-facing owner list editor.
 *
 * Owners could previously only be added, never corrected or removed, so a
 * duplicate created by a differently-spelled name was permanent. Deal
 * b296dec2 accumulated three owners totalling 149% ("Matthew Paller" 49%
 * and "matt paller" 49% alongside "Sebrina Colon" 51%), which put three
 * people over the 20% verification threshold and made the sealing gate
 * unsatisfiable — the borrower had no control anywhere in the product
 * that could fix it.
 *
 * Every state here keeps at least one thing the borrower can do, and the
 * running total is always visible so "why can't I submit" is answered on
 * the screen rather than in a support thread.
 */

type Owner = {
  id: string;
  displayName: string | null;
  ownershipPct: number | null;
  requiresVerification: boolean;
};

type Summary = {
  total: number;
  valid: boolean;
  problem: "over" | "under" | null;
  duplicateNames: string[];
  ownersRequiringVerification: number;
};

export function OwnershipEditor({
  token,
  onChanged,
}: {
  token: string;
  onChanged?: () => void;
}) {
  const [owners, setOwners] = useState<Owner[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [threshold, setThreshold] = useState(20);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { name: string; pct: string }>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/borrower/portal/${token}/owners`);
      const json = await res.json().catch(() => null);
      if (res.ok && json?.ok && Array.isArray(json.owners)) {
        setOwners(json.owners);
        setSummary(json.summary ?? null);
        setThreshold(json.threshold ?? 20);
        setDrafts(
          Object.fromEntries(
            json.owners.map((o: Owner) => [
              o.id,
              { name: o.displayName ?? "", pct: o.ownershipPct === null ? "" : String(o.ownershipPct) },
            ]),
          ),
        );
        setLoadFailed(false);
      } else {
        setLoadFailed(true);
      }
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const save = useCallback(
    async (ownerId: string) => {
      const draft = drafts[ownerId];
      if (!draft) return;
      setBusyId(ownerId);
      setError(null);
      try {
        const res = await fetch(`/api/borrower/portal/${token}/owners`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ownerId,
            displayName: draft.name,
            ownershipPct: Number(draft.pct),
          }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.ok) {
          setError(json?.message ?? "We could not save that change. Please try again.");
          return;
        }
        await load();
        onChanged?.();
      } catch {
        setError("We could not save that change. Please try again.");
      } finally {
        setBusyId(null);
      }
    },
    [drafts, token, load, onChanged],
  );

  const remove = useCallback(
    async (ownerId: string) => {
      setBusyId(ownerId);
      setError(null);
      try {
        const res = await fetch(`/api/borrower/portal/${token}/owners`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ownerId }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.ok) {
          setError(json?.message ?? "We could not remove that owner. Please try again.");
          return;
        }
        await load();
        onChanged?.();
      } catch {
        setError("We could not remove that owner. Please try again.");
      } finally {
        setBusyId(null);
      }
    },
    [token, load, onChanged],
  );

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-brand-blue-500 border-t-transparent" />
        Loading owners…
      </div>
    );
  }

  if (loadFailed) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-rose-700">We could not load your owner list.</p>
        <button
          type="button"
          onClick={() => { setLoading(true); void load(); }}
          className="min-h-[32px] rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          Try again
        </button>
      </div>
    );
  }

  const dirty = (o: Owner) => {
    const d = drafts[o.id];
    if (!d) return false;
    return d.name !== (o.displayName ?? "") || d.pct !== (o.ownershipPct === null ? "" : String(o.ownershipPct));
  };

  return (
    <div className="space-y-3">
      {summary && !summary.valid && (
        <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p className="font-medium">
            Ownership adds up to {summary.total}%, not 100%.
          </p>
          <p className="mt-1 text-xs">
            {summary.problem === "over"
              ? "That usually means someone is listed twice. Remove or correct the duplicate below — you cannot submit until this totals 100%."
              : "Add the missing owner, or raise a percentage below, until this totals 100%."}
            {summary.duplicateNames.length > 0 && (
              <> Possible duplicate: <span className="font-medium">{summary.duplicateNames.join(", ")}</span>.</>
            )}
          </p>
        </div>
      )}

      {summary?.valid && (
        <p className="text-xs text-emerald-700">
          Ownership totals 100%. {summary.ownersRequiringVerification} owner
          {summary.ownersRequiringVerification === 1 ? "" : "s"} at {threshold}% or more
          need identity verification.
        </p>
      )}

      {error && (
        <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {owners.map((o) => {
        const d = drafts[o.id] ?? { name: "", pct: "" };
        const busy = busyId === o.id;
        return (
          <div key={o.id} className="rounded-lg border border-slate-200 px-4 py-3">
            <div className="grid grid-cols-3 gap-3">
              <input
                type="text"
                aria-label="Owner name"
                value={d.name}
                disabled={busy}
                onChange={(e) =>
                  setDrafts((prev) => ({ ...prev, [o.id]: { ...d, name: e.target.value } }))
                }
                className="col-span-2 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue-500"
              />
              <div className="relative">
                <input
                  type="number"
                  aria-label="Ownership percent"
                  min={0}
                  max={100}
                  value={d.pct}
                  disabled={busy}
                  onChange={(e) =>
                    setDrafts((prev) => ({ ...prev, [o.id]: { ...d, pct: e.target.value } }))
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 pr-7 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue-500"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">%</span>
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs text-slate-500">
                {o.requiresVerification ? "Needs identity verification" : "Below verification threshold"}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => remove(o.id)}
                  disabled={busy}
                  className="min-h-[32px] rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                >
                  Remove
                </button>
                <button
                  type="button"
                  onClick={() => save(o.id)}
                  disabled={busy || !dirty(o)}
                  className="brand-gradient-cta min-h-[32px] rounded-lg px-3 py-1.5 text-xs font-medium text-white hover:brightness-110 disabled:opacity-40"
                >
                  {busy ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        );
      })}

      {owners.length === 0 && (
        <p className="text-sm text-slate-500">
          No owners on file yet. Add them in the ownership step of your application.
        </p>
      )}
    </div>
  );
}
