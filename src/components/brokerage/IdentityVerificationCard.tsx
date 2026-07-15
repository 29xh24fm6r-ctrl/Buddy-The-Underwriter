"use client";

/**
 * Ticket 2 (SPEC-BROKERAGE-SBA-READY-V1) — borrower-facing IAL2 identity
 * verification. Mirrors SealPackageCard's visual grammar and polling
 * pattern. Lists every owner at/above the 20% ownership threshold
 * (src/lib/ownership/rules.ts's requiresPersonalPackage) and lets the
 * borrower launch a Persona one-time verification link per owner — same
 * "open in a new tab" UX SbaSigningPanel.tsx uses for the Underwriter
 * tenant. Rendered before SealPackageCard on /start: identity verification
 * gates sealing (see sealingGate.ts's gate #6 and the T2 AAR for why).
 */

import { useEffect, useState } from "react";

type OwnerRow = {
  ownershipEntityId: string;
  displayName: string | null;
  ownershipPct: number | null;
  ial2Status: "verified" | "pending" | "declined" | "not_started";
};

const STATUS_LABEL: Record<OwnerRow["ial2Status"], string> = {
  verified: "Verified",
  pending: "Pending review",
  declined: "Needs retry",
  not_started: "Not started",
};

const STATUS_STYLE: Record<OwnerRow["ial2Status"], string> = {
  verified: "text-emerald-700 bg-emerald-50",
  pending: "text-amber-700 bg-amber-50",
  declined: "text-rose-700 bg-rose-50",
  not_started: "text-slate-600 bg-slate-100",
};

export function IdentityVerificationCard({ dealId }: { dealId: string }) {
  const [owners, setOwners] = useState<OwnerRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await fetch(`/api/brokerage/deals/${dealId}/borrower-actions/kyc`, {
        credentials: "include",
      });
      if (!res.ok) {
        setError("Could not load identity verification status");
        return;
      }
      const data = await res.json();
      if (!data.ok) {
        setError("Could not load identity verification status");
        return;
      }
      setOwners(data.owners ?? []);
      setError(null);
    } catch {
      setError("Network error");
    }
  };

  useEffect(() => {
    void load();
  }, [dealId]);

  const startVerification = async (ownershipEntityId: string) => {
    if (busyId) return;
    setBusyId(ownershipEntityId);
    setError(null);
    try {
      const res = await fetch(`/api/brokerage/deals/${dealId}/borrower-actions/kyc`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownership_entity_id: ownershipEntityId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data.ok) {
        setError(
          data.error === "persona_not_configured"
            ? "Identity verification isn't available yet — check back soon."
            : "Could not start identity verification",
        );
      } else {
        if (data.oneTimeLink) {
          window.open(data.oneTimeLink, "_blank", "noopener,noreferrer");
        }
        await load();
      }
    } catch {
      setError("Network error");
    } finally {
      setBusyId(null);
    }
  };

  // Nothing to show until the deal has owners on record, or once every
  // majority owner is already verified — avoid an empty/redundant card.
  if (!owners || owners.length === 0) return null;
  if (owners.every((o) => o.ial2Status === "verified")) return null;

  return (
    <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-semibold text-slate-900 mb-2">
        Verify your identity
      </h3>
      <p className="text-sm text-slate-600 mb-4">
        Owners with 20% or more of the business need to verify their identity
        before Buddy can seal your package for the marketplace. This takes
        about 2 minutes per owner and opens in a new tab.
      </p>
      <ul className="space-y-2">
        {owners.map((owner) => (
          <li
            key={owner.ownershipEntityId}
            className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2"
          >
            <div>
              <span className="text-sm font-medium text-slate-800">
                {owner.displayName ?? "Owner"}
              </span>
              <span
                className={`ml-2 text-xs font-medium px-2 py-0.5 rounded ${STATUS_STYLE[owner.ial2Status]}`}
              >
                {STATUS_LABEL[owner.ial2Status]}
              </span>
            </div>
            {owner.ial2Status !== "verified" && (
              <button
                onClick={() => startVerification(owner.ownershipEntityId)}
                disabled={busyId === owner.ownershipEntityId}
                className="px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                type="button"
              >
                {busyId === owner.ownershipEntityId
                  ? "Opening…"
                  : owner.ial2Status === "not_started"
                    ? "Verify identity"
                    : "Retry verification"}
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
    </div>
  );
}
