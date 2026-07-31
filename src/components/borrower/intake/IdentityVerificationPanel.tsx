"use client";

import { useEffect, useState, useCallback } from "react";

type OwnerKycStatus = {
  ownershipEntityId: string;
  displayName: string;
  ownershipPct: number | null;
  verification: {
    id: string;
    status: string;
    sessionUrl: string | null;
    completedAt: string | null;
  } | null;
};

const STATUS_DISPLAY: Record<string, { label: string; cls: string }> = {
  approved: { label: "Verified", cls: "text-emerald-700 bg-emerald-50" },
  completed: { label: "Verified", cls: "text-emerald-700 bg-emerald-50" },
  pending: { label: "In Progress", cls: "text-amber-700 bg-amber-50" },
  created: { label: "Started", cls: "text-blue-700 bg-blue-50" },
  needs_review: { label: "Under Review", cls: "text-amber-700 bg-amber-50" },
  failed: { label: "Failed", cls: "text-rose-700 bg-rose-50" },
  declined: { label: "Declined", cls: "text-rose-700 bg-rose-50" },
  expired: { label: "Expired", cls: "text-slate-700 bg-slate-50" },
};

export function IdentityVerificationPanel({ token }: { token: string }) {
  const [owners, setOwners] = useState<OwnerKycStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [initiating, setInitiating] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/borrower/portal/${token}/identity`);
      const json = await res.json();
      if (json?.ok && Array.isArray(json.owners)) {
        setOwners(json.owners);
      }
    } catch {
      // non-fatal
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const startVerification = useCallback(async (ownershipEntityId: string) => {
    setInitiating(ownershipEntityId);
    try {
      const res = await fetch(`/api/borrower/portal/${token}/identity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownershipEntityId }),
      });
      const json = await res.json();
      if (json?.ok && json.sessionUrl) {
        window.open(json.sessionUrl, "_blank", "noopener,noreferrer");
        await load();
      }
    } catch {
      // non-fatal
    } finally {
      setInitiating(null);
    }
  }, [token, load]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <div className="w-4 h-4 border-2 border-brand-blue-500 border-t-transparent rounded-full animate-spin" />
        Checking identity verification status...
      </div>
    );
  }

  if (owners.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        No owners require identity verification at this time.
      </p>
    );
  }

  const allVerified = owners.every(
    (o) => o.verification && ["approved", "completed"].includes(o.verification.status),
  );

  return (
    <div className="space-y-3">
      {allVerified && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-sm text-emerald-700">
          All owners have completed identity verification.
        </div>
      )}

      {owners.map((o) => {
        const v = o.verification;
        const status = v ? (STATUS_DISPLAY[v.status] ?? { label: v.status, cls: "text-slate-700 bg-slate-50" }) : null;
        const canStart = !v || ["expired", "failed", "declined"].includes(v.status);
        const canResume = v && ["created", "pending"].includes(v.status) && v.sessionUrl;

        return (
          <div key={o.ownershipEntityId} className="flex items-center justify-between border border-slate-200 rounded-lg px-4 py-3">
            <div>
              <p className="text-sm font-medium text-slate-800">{o.displayName}</p>
              <p className="text-xs text-slate-500">{o.ownershipPct}% owner</p>
            </div>
            <div className="flex items-center gap-2">
              {status && (
                <span className={`text-xs font-medium px-2 py-1 rounded-full ${status.cls}`}>
                  {status.label}
                </span>
              )}
              {canStart && (
                <button
                  type="button"
                  onClick={() => startVerification(o.ownershipEntityId)}
                  disabled={initiating === o.ownershipEntityId}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg brand-gradient-cta text-white hover:brightness-110 disabled:opacity-50 min-h-[32px]"
                >
                  {initiating === o.ownershipEntityId ? "Starting..." : "Verify ID"}
                </button>
              )}
              {canResume && (
                <a
                  href={v!.sessionUrl!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium px-3 py-1.5 rounded-lg border border-blue-300 text-blue-700 hover:bg-blue-50 min-h-[32px] inline-flex items-center"
                >
                  Continue
                </a>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
