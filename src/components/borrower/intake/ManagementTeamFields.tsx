"use client";

// src/components/borrower/intake/ManagementTeamFields.tsx
// SPEC-BORROWER-STRUCTURED-ASSUMPTIONS-1 — structured management-team
// capture, moved out of AssumptionInterview's "management" sub-step and
// into the Ownership & Management chapter (per product decision: ownership
// and management are the same people, collected together).
//
// Reuses the CANONICAL management-team model — same ManagementMember type,
// same buddy_sba_assumptions.management_team column, same
// /api/borrower/portal/[token]/sba-assumptions GET/PATCH contract that
// AssumptionInterview already uses. This is not a second, competing
// management model — it is the same data, edited from a different screen.
// AssumptionInterview is told to skip its own management sub-step
// (showManagementStep={false}) when it renders later in the funnel so the
// borrower is never asked for the same thing twice.
//
// This directly resolves the "At least one management team member is
// required" blocker from sbaAssumptionsValidator.ts — before this
// component existed, nothing in the self-serve /start funnel could ever
// satisfy it.

import { useState, useEffect, useCallback, useRef } from "react";
import type { ManagementMember } from "@/lib/sba/sbaReadinessTypes";

type SaveState = "idle" | "saving" | "saved" | "error";

const labelCls = "mb-1 block text-xs font-medium text-slate-600";
const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue-500";

function emptyMember(): ManagementMember {
  return { name: "", title: "", yearsInIndustry: 0, bio: "" };
}

export function ManagementTeamFields({
  dealId,
  defaultName,
}: {
  dealId: string;
  defaultName?: string | null;
}) {
  // The self-serve /start funnel authenticates via the borrower session
  // cookie, not an admin-issued invite token — resolvePortalContext()
  // accepts the deal's own id as `token` for exactly this case (see that
  // file's docstring). Same pattern IdentityVerificationPanel/PostSubmitHub/
  // AssumptionInterview already use.
  const token = dealId;

  const [members, setMembers] = useState<ManagementMember[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const defaultNameRef = useRef(defaultName);
  defaultNameRef.current = defaultName;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/borrower/portal/${token}/sba-assumptions`);
        const json = await res.json();
        if (cancelled) return;
        const existing = json?.assumptions?.managementTeam as
          | ManagementMember[]
          | undefined;
        const prefilled = json?.prefilled?.managementTeam as
          | ManagementMember[]
          | undefined;
        const fallbackName = defaultNameRef.current;
        if (existing?.length) {
          setMembers(existing);
        } else if (prefilled?.length) {
          setMembers(prefilled);
        } else if (fallbackName && fallbackName.trim()) {
          setMembers([{ ...emptyMember(), name: fallbackName.trim(), title: "Owner" }]);
        } else {
          setMembers([emptyMember()]);
        }
      } catch {
        setMembers((prev) => (prev.length ? prev : [emptyMember()]));
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const persist = useCallback(
    (next: ManagementMember[]) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      setSaveState("saving");
      saveTimer.current = setTimeout(async () => {
        try {
          const res = await fetch(`/api/borrower/portal/${token}/sba-assumptions`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ patch: { managementTeam: next } }),
            credentials: "include",
          });
          const json = await res.json();
          setSaveState(json?.ok ? "saved" : "error");
        } catch {
          setSaveState("error");
        }
      }, 600);
    },
    [token],
  );

  const updateMember = useCallback(
    (idx: number, patch: Partial<ManagementMember>) => {
      setMembers((prev) => {
        const next = prev.map((m, i) => (i === idx ? { ...m, ...patch } : m));
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const addMember = useCallback(() => {
    setMembers((prev) => {
      const next = [...prev, emptyMember()];
      persist(next);
      return next;
    });
  }, [persist]);

  const removeMember = useCallback(
    (idx: number) => {
      setMembers((prev) => {
        const next = prev.filter((_, i) => i !== idx);
        persist(next);
        return next;
      });
    },
    [persist],
  );

  if (!loaded) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white px-6 py-5 text-sm text-slate-400">
        Loading management team…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-semibold text-slate-800">Management team</h4>
        <p className="mt-1 text-xs text-slate-500">
          Tell us who runs the business day to day. This goes into your
          business plan and SBA package — a short bio is enough, no resume
          needed.
        </p>
      </div>

      {members.map((m, idx) => (
        <div
          key={idx}
          className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm space-y-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-600">
              Team member {idx + 1}
            </span>
            {members.length > 1 && (
              <button
                type="button"
                onClick={() => removeMember(idx)}
                className="text-xs text-slate-400 hover:text-red-500"
              >
                Remove
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Name</label>
              <input
                className={inputCls}
                value={m.name}
                onChange={(e) => updateMember(idx, { name: e.target.value })}
                placeholder="Jane Smith"
              />
            </div>
            <div>
              <label className={labelCls}>Title</label>
              <input
                className={inputCls}
                value={m.title}
                onChange={(e) => updateMember(idx, { title: e.target.value })}
                placeholder="Managing Member"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Years in industry</label>
              <input
                className={inputCls}
                inputMode="numeric"
                value={m.yearsInIndustry ? String(m.yearsInIndustry) : ""}
                onChange={(e) =>
                  updateMember(idx, {
                    yearsInIndustry: parseInt(e.target.value, 10) || 0,
                  })
                }
                placeholder="10"
              />
            </div>
            <div>
              <label className={labelCls}>Ownership %</label>
              <input
                className={inputCls}
                inputMode="numeric"
                value={m.ownershipPct != null ? String(m.ownershipPct) : ""}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  updateMember(idx, {
                    ownershipPct: Number.isFinite(v) ? v : undefined,
                  });
                }}
                placeholder="51"
              />
            </div>
          </div>
          <div>
            <label className={labelCls}>
              Brief bio (2–3 sentences about relevant experience)
            </label>
            <textarea
              className={inputCls + " resize-none"}
              rows={3}
              value={m.bio}
              onChange={(e) => updateMember(idx, { bio: e.target.value })}
              placeholder="15 years in commercial property management. Previously managed a portfolio of 50+ units across 3 states."
            />
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={addMember}
        className="w-full rounded-lg border border-dashed border-slate-300 py-3 text-sm text-slate-500 transition hover:border-slate-400"
      >
        + Add team member
      </button>

      <p className="text-xs text-slate-400">
        {saveState === "saving" && "Saving…"}
        {saveState === "saved" && "Saved"}
        {saveState === "error" && "Couldn't save — check your connection"}
      </p>
    </div>
  );
}
