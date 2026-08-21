"use client";

/**
 * Chapter 3 — who owns this business.
 *
 * This step used to be CREATE-ONLY. It rendered a blank form on every
 * visit, never showed what the deal already held, offered no way to fix a
 * name and no way to delete a row. A borrower who returned to the
 * application re-entered their cap table and got a second copy of it, and
 * a typo was permanent. Deal b296dec2 ended up with three owners —
 * Sebrina Colon 51%, Matthew Paller 49% and a duplicate "matt paller" 49%
 * — totalling 149%, with no borrower-reachable way back.
 *
 * Three things changed:
 *
 *   1. It LOADS. Existing owners come back from list_ownership and are
 *      editable in place, so the form shows the truth instead of a blank.
 *   2. It ADDS UP. The running total is always visible, a total that isn't
 *      100% is called out, and Continue is disabled until it is. The
 *      sealing gate blocks on the same arithmetic, so nothing that passes
 *      here is refused later.
 *   3. It ASKS BEFORE DUPLICATING. Typing a near-match of an owner already
 *      on the list ("matt paller" against "Matthew Paller") prompts "Did
 *      you mean Matthew Paller?" rather than quietly creating a third row.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { IdentityVerificationCard } from "@/components/brokerage/IdentityVerificationCard";
import { compareOwnerNames } from "@/lib/ownership/ownerNameMatch";
import { summarizeOwnership } from "@/lib/ownership/ownershipTotals";

type OwnerStructure = "solo" | "multi" | null;

type OwnerRow = {
  /** ownership_entities.id, or null for a row the borrower just added. */
  id: string | null;
  name: string;
  pct: string;
  removable: boolean;
  notRemovableReason: string | null;
};

type LoadedOwner = {
  id: string;
  full_name: string;
  ownership_pct: number | null;
  removable: boolean;
  notRemovableReason: string | null;
};

function blankRow(): OwnerRow {
  return { id: null, name: "", pct: "", removable: true, notRemovableReason: null };
}

export function IntakeOwnershipStep({
  dealId,
  borrowerName,
  onContinue,
}: {
  dealId: string;
  borrowerName?: string | null;
  onContinue: (data?: Record<string, unknown>) => void;
}) {
  const [structure, setStructure] = useState<OwnerStructure>(null);
  const [ownershipSaved, setOwnershipSaved] = useState(false);
  const [owners, setOwners] = useState<OwnerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [retained, setRetained] = useState<Array<{ display_name: string; reason: string }>>([]);
  /** Index of the row whose near-duplicate name is awaiting confirmation. */
  const [pendingMerge, setPendingMerge] = useState<{
    index: number;
    matchIndex: number;
  } | null>(null);

  /**
   * Load what the deal already holds. A returning borrower must see their
   * real cap table — showing a blank form is what invited the duplicate
   * entry in the first place.
   */
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/brokerage/concierge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "list_ownership" }),
        credentials: "include",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok || !Array.isArray(data.owners)) {
        setLoadFailed(true);
        return;
      }

      const loaded = (data.owners as LoadedOwner[]).map<OwnerRow>((o) => ({
        id: o.id,
        name: o.full_name,
        pct: o.ownership_pct == null ? "" : String(o.ownership_pct),
        removable: o.removable !== false,
        notRemovableReason: o.notRemovableReason ?? null,
      }));

      if (loaded.length > 0) {
        setOwners(loaded);
        // Infer the structure they already chose rather than making them
        // answer it again. A single 100% owner is the solo path.
        setStructure(loaded.length === 1 ? "solo" : "multi");
      } else {
        const prefill = (borrowerName ?? "").trim();
        setOwners([{ ...blankRow(), name: prefill, pct: "100" }]);
      }
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [borrowerName]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateOwner = useCallback(
    (idx: number, field: "name" | "pct", value: string) => {
      setOwners((prev) => prev.map((o, i) => (i === idx ? { ...o, [field]: value } : o)));
      setOwnershipSaved(false);
      setSaveError(null);
    },
    [],
  );

  const addOwner = useCallback(() => {
    setOwners((prev) => [...prev, blankRow()]);
    setStructure("multi");
    setOwnershipSaved(false);
  }, []);

  /**
   * Picking a structure reshapes the list rather than replacing it, so an
   * accidental tap on "Just me" never silently discards a co-owner the
   * borrower already entered — extra rows stay in the list, and the total
   * warning below tells them what to fix.
   */
  const chooseStructure = useCallback((next: Exclude<OwnerStructure, null>) => {
    setStructure(next);
    setOwnershipSaved(false);
    setOwners((prev) => {
      if (prev.length === 0) return [{ ...blankRow(), pct: next === "solo" ? "100" : "" }];
      if (next === "solo" && prev.length === 1) {
        return [{ ...prev[0], pct: "100" }];
      }
      if (next === "multi" && prev.length === 1) {
        return [prev[0], blankRow()];
      }
      return prev;
    });
  }, []);

  /**
   * Remove a row. A row that exists in the database is deleted server-side
   * straight away rather than on the next save — the save path requires a
   * 100% total, and a borrower staring at a duplicate is at 149% by
   * definition and could never submit it.
   */
  const removeOwner = useCallback(async (idx: number) => {
    const target = owners[idx];
    if (!target) return;

    if (!target.id) {
      setOwners((prev) => prev.filter((_, i) => i !== idx));
      setOwnershipSaved(false);
      return;
    }

    setRemovingId(target.id);
    setSaveError(null);
    try {
      const res = await fetch("/api/brokerage/concierge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "delete_owner", ownerId: target.id }),
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setSaveError(data.detail ?? "Could not remove that owner. Please try again.");
        return;
      }
      setOwners((prev) => prev.filter((_, i) => i !== idx));
      setOwnershipSaved(false);
    } catch {
      setSaveError("Could not remove that owner. Please try again.");
    } finally {
      setRemovingId(null);
    }
  }, [owners]);

  /**
   * "Did you mean Matthew Paller?" — fired when a row's name is finished
   * (blur) and it resembles a DIFFERENT row already on the list. Merging
   * silently would be wrong (the borrower may genuinely have two similar
   * names); creating a duplicate silently is what produced deal b296dec2.
   * So we ask.
   */
  const checkForNearDuplicate = useCallback(
    (idx: number) => {
      const row = owners[idx];
      if (!row?.name.trim()) return;
      const matchIndex = owners.findIndex(
        (other, i) =>
          i !== idx &&
          other.name.trim() &&
          compareOwnerNames(row.name, other.name) !== null,
      );
      if (matchIndex >= 0) setPendingMerge({ index: idx, matchIndex });
    },
    [owners],
  );

  const applyMerge = useCallback(() => {
    if (!pendingMerge) return;
    const { index, matchIndex } = pendingMerge;
    setOwners((prev) => {
      const duplicate = prev[index];
      const canonical = prev[matchIndex];
      if (!duplicate || !canonical) return prev;
      // Keep the canonical row (it carries the database id) and fold the
      // percentage the borrower just typed into it, then drop the
      // duplicate. Nothing is deleted server-side here: the duplicate row
      // being merged is the one they were still typing.
      const merged = prev.map((o, i) =>
        i === matchIndex ? { ...canonical, pct: duplicate.pct || canonical.pct } : o,
      );
      return merged.filter((_, i) => i !== index);
    });
    setPendingMerge(null);
    setOwnershipSaved(false);
  }, [pendingMerge]);

  const summary = useMemo(
    () =>
      summarizeOwnership(
        owners
          .filter((o) => o.name.trim())
          .map((o) => ({
            display_name: o.name.trim(),
            ownership_pct: o.pct === "" ? null : Number(o.pct),
          })),
      ),
    [owners],
  );

  const namedOwners = owners.filter((o) => o.name.trim());
  const everyOwnerComplete =
    namedOwners.length === owners.length && owners.every((o) => o.pct !== "");
  const canContinue =
    !saving &&
    !loading &&
    structure !== null &&
    owners.length > 0 &&
    everyOwnerComplete &&
    summary.ok &&
    !pendingMerge;

  const saveOwnership = useCallback(async () => {
    const payload = owners
      .filter((o) => o.name.trim())
      .map((o) => ({
        id: o.id,
        full_name: o.name.trim(),
        ownership_pct: Number(o.pct),
      }));
    const effectiveStructure = payload.length === 1 ? "solo" : "multi";

    setSaving(true);
    setSaveError(null);
    setRetained([]);
    try {
      const response = await fetch("/api/brokerage/concierge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "save_ownership",
          structure: effectiveStructure,
          owners: payload,
        }),
        credentials: "include",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        setSaveError(
          data.detail ??
            "Please complete every owner and make sure ownership totals 100%.",
        );
        return false;
      }
      // Adopt the server's row ids so a second save edits these rows
      // instead of matching them by name all over again.
      if (Array.isArray(data.owners)) {
        setOwners(
          (data.owners as Array<{ id: string; display_name: string; ownership_pct: number }>).map(
            (o) => ({
              id: o.id,
              name: o.display_name,
              pct: String(o.ownership_pct),
              removable: true,
              notRemovableReason: null,
            }),
          ),
        );
      }
      if (Array.isArray(data.retained) && data.retained.length > 0) {
        setRetained(data.retained);
      }
      setStructure(effectiveStructure);
      setOwnershipSaved(true);
      return true;
    } catch {
      setSaveError("Could not save ownership. Please try again.");
      return false;
    } finally {
      setSaving(false);
    }
  }, [owners]);

  if (loading) {
    return (
      <p className="text-sm text-slate-500">Loading the owners on your application…</p>
    );
  }

  return (
    <div className="space-y-6">
      {/* Buddy bubble */}
      <div className="flex gap-3">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-blue-500 to-brand-blue-400 text-sm font-bold text-white">
          B
        </div>
        <div className="rounded-2xl rounded-bl-md bg-slate-100 px-5 py-3.5">
          <p className="text-sm text-slate-800">
            SBA requires identity verification for every owner with 20% or more.
            List everyone who owns part of the business — the percentages need to
            add up to exactly 100%.
          </p>
        </div>
      </div>

      {loadFailed && (
        <div className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
          <p className="text-xs text-rose-700">
            We couldn&apos;t load the owners already on your application. Adding
            owners now could duplicate them.
          </p>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              void load();
            }}
            className="shrink-0 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-white"
          >
            Try again
          </button>
        </div>
      )}

      {/* Structure selection */}
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => chooseStructure("solo")}
          className={`w-full rounded-2xl border-[1.5px] bg-white px-6 py-5 text-left transition-all ${
            structure === "solo"
              ? "border-brand-blue-500 shadow-lg shadow-blue-100/50"
              : "border-slate-200 hover:-translate-y-0.5 hover:shadow-lg"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">👤</span>
              <div>
                <p className="text-sm font-medium text-slate-900">Just me</p>
                <p className="text-xs text-slate-500">I&apos;m the sole owner (100%)</p>
              </div>
            </div>
            <div
              className={`flex h-6 w-6 items-center justify-center rounded-full transition-all duration-300 ${
                structure === "solo"
                  ? "scale-100 bg-[#0A1F44] opacity-100"
                  : "scale-90 bg-slate-100 opacity-60"
              }`}
            >
              {structure === "solo" && (
                <svg className="h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => chooseStructure("multi")}
          className={`w-full rounded-2xl border-[1.5px] bg-white px-6 py-5 text-left transition-all ${
            structure === "multi"
              ? "border-brand-blue-500 shadow-lg shadow-blue-100/50"
              : "border-slate-200 hover:-translate-y-0.5 hover:shadow-lg"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">👥</span>
              <div>
                <p className="text-sm font-medium text-slate-900">Two or more owners</p>
                <p className="text-xs text-slate-500">Each 20%+ owner will need to verify their identity</p>
              </div>
            </div>
            <div
              className={`flex h-6 w-6 items-center justify-center rounded-full transition-all duration-300 ${
                structure === "multi"
                  ? "scale-100 bg-[#0A1F44] opacity-100"
                  : "scale-90 bg-slate-100 opacity-60"
              }`}
            >
              {structure === "multi" && (
                <svg className="h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
          </div>
        </button>
      </div>

      {/* Owner list, running total and duplicate prompt — shown once the
          borrower has told us the shape of the cap table, or immediately
          if the deal already holds owners. */}
      {structure && (
        <>
        {/* Owner rows */}
        <div className="space-y-3">
          {owners.map((owner, i) => (
            <div
              key={owner.id ?? `new-${i}`}
              className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm"
            >
              <div className="mb-3 flex items-center justify-between">
                <h4 className="text-sm font-medium text-slate-700">
                  {i === 0 ? "Primary owner" : `Owner ${i + 1}`}
                </h4>
                {owners.length > 1 &&
                  (owner.removable ? (
                    <button
                      type="button"
                      onClick={() => void removeOwner(i)}
                      disabled={removingId === owner.id}
                      className="text-xs text-slate-400 hover:text-red-500 disabled:opacity-50"
                    >
                      {removingId === owner.id ? "Removing…" : "Remove"}
                    </button>
                  ) : (
                    <span
                      className="text-xs text-slate-400"
                      title={owner.notRemovableReason ?? undefined}
                    >
                      Can&apos;t be removed here
                    </span>
                  ))}
              </div>
              <div className="grid grid-cols-3 gap-3">
                <input
                  type="text"
                  value={owner.name}
                  onChange={(e) => updateOwner(i, "name", e.target.value)}
                  onBlur={() => checkForNearDuplicate(i)}
                  placeholder="Full legal name"
                  className="col-span-2 rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue-500"
                />
                <div className="relative">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={owner.pct}
                    onChange={(e) => updateOwner(i, "pct", e.target.value)}
                    placeholder="%"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2.5 pr-7 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue-500"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                    %
                  </span>
                </div>
              </div>
              {!owner.removable && owner.notRemovableReason && (
                <p className="mt-2 text-xs text-slate-500">
                  {owner.notRemovableReason.charAt(0).toUpperCase() +
                    owner.notRemovableReason.slice(1)}
                  . Message your advisor to change this owner.
                </p>
              )}
            </div>
          ))}

          <button
            type="button"
            onClick={addOwner}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 bg-white px-5 py-4 text-sm font-medium text-slate-500 transition-colors hover:border-brand-blue-300 hover:text-brand-blue-500"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add another owner
          </button>
        </div>

        {/* "Did you mean …?" — before a near-duplicate becomes a third row. */}
        {pendingMerge && (
          <div className="animate-in slide-in-from-top-2 fade-in duration-300 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
            <p className="text-sm font-medium text-amber-900">
              Did you mean {owners[pendingMerge.matchIndex]?.name}?
            </p>
            <p className="mt-1 text-xs text-amber-700">
              &ldquo;{owners[pendingMerge.index]?.name}&rdquo; looks like the same
              person you&apos;ve already listed. Listing someone twice puts your
              ownership over 100% and creates a second identity check they can
              never finish.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={applyMerge}
                className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
              >
                Yes — they&apos;re the same person
              </button>
              <button
                type="button"
                onClick={() => setPendingMerge(null)}
                className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-50"
              >
                No — two different people
              </button>
            </div>
          </div>
        )}

        {/* Running total — always visible, so a wrong one is never a surprise
            at the end. */}
        <div
          className={`rounded-2xl border px-5 py-4 ${
            summary.ok
              ? "border-emerald-200 bg-emerald-50"
              : "border-amber-200 bg-amber-50"
          }`}
        >
          <div className="flex items-center justify-between">
            <p
              className={`text-sm font-medium ${
                summary.ok ? "text-emerald-900" : "text-amber-900"
              }`}
            >
              Total ownership
            </p>
            <p
              className={`text-sm font-semibold ${
                summary.ok ? "text-emerald-700" : "text-amber-800"
              }`}
            >
              {summary.totalPct}%
            </p>
          </div>
          {summary.ok ? (
            <p className="mt-1 text-xs text-emerald-700">
              Adds up to 100% — that&apos;s what lenders need to see.
            </p>
          ) : (
            <ul className="mt-1 space-y-1">
              {summary.issues.map((issue, i) => (
                <li key={i} className="text-xs text-amber-800">
                  {issue.code === "no_owners"
                    ? "Add at least one owner to continue."
                    : issue.message}
                </li>
              ))}
            </ul>
          )}
        </div>

        </>
      )}

      {retained.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4">
          <p className="text-sm font-medium text-slate-800">
            We kept {retained.length === 1 ? "one owner" : `${retained.length} owners`} you removed
          </p>
          <ul className="mt-1 space-y-1">
            {retained.map((r) => (
              <li key={r.display_name} className="text-xs text-slate-600">
                {r.display_name} — {r.reason}. Message your advisor to change this.
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Identity verification — wait for the save so the ownership entity exists */}
      {structure && ownershipSaved && (
        <div className="animate-in slide-in-from-top-2 fade-in duration-300">
          <IdentityVerificationCard dealId={dealId} />
        </div>
      )}

      {saveError && <p className="text-sm text-rose-600">{saveError}</p>}

      {/* Continue */}
      <div className="flex justify-end pt-2">
        <button
          type="button"
          disabled={!canContinue}
          onClick={async () => {
            const saved = await saveOwnership();
            if (saved) onContinue({ structure: owners.length === 1 ? "solo" : "multi" });
          }}
          className="brand-gradient-cta rounded-2xl px-8 py-3 text-sm font-medium text-white shadow-sm hover:brightness-110 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Continue →"}
        </button>
      </div>
    </div>
  );
}
