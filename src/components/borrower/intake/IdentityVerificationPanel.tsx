"use client";

import { useEffect, useState, useCallback } from "react";
import { OwnershipEditor } from "./OwnershipEditor";

/**
 * Identity verification panel.
 *
 * The dead end this replaces: on 2026-08-25 a borrower completed Didit
 * verification, the completion webhook was never delivered, and the row
 * stayed at "created". This panel rendered that as the chip "Started" plus
 * a single "Continue" link pointing back at the Didit session the borrower
 * had already finished. There was no way to refresh, no way to retry, and
 * no explanation — and the sealing gate stayed shut behind it.
 *
 * Three rules now hold, and the tests in
 * __tests__/verificationTruth.test.tsx pin them:
 *
 *  1. State shown is RECONCILED state. The GET handler re-reads Didit
 *     before answering, so opening this panel repairs a stranded row.
 *  2. Every owner who is not verified has at least one enabled control.
 *     "Refresh status" is always available once a verification exists, so
 *     there is no reachable state with zero moves.
 *  3. Waiting is stated, not implied — what we are waiting on and what
 *     happens next, rather than a bare status chip.
 */

type OwnerKycStatus = {
  ownershipEntityId: string;
  displayName: string;
  ownershipPct: number | null;
  verified: boolean;
  verification: {
    id: string;
    status: string;
    sessionUrl: string | null;
    completedAt: string | null;
  } | null;
  actions: {
    canStart: boolean;
    canResume: boolean;
    canRefresh: boolean;
  };
};

type OwnershipSummary = { total: number; valid: boolean; ownerCount: number };

const STATUS_DISPLAY: Record<string, { label: string; cls: string }> = {
  approved: { label: "Verified", cls: "text-emerald-700 bg-emerald-50" },
  completed: { label: "Verified", cls: "text-emerald-700 bg-emerald-50" },
  pending: { label: "In Progress", cls: "text-amber-700 bg-amber-50" },
  created: { label: "Not finished", cls: "text-blue-700 bg-blue-50" },
  needs_review: { label: "Under Review", cls: "text-amber-700 bg-amber-50" },
  failed: { label: "Not completed", cls: "text-rose-700 bg-rose-50" },
  declined: { label: "Declined", cls: "text-rose-700 bg-rose-50" },
  expired: { label: "Expired", cls: "text-slate-700 bg-slate-50" },
};

/**
 * What the borrower is waiting on, and what resolves it. Every non-verified
 * status has an entry — a status with no explanation is how the previous
 * panel left someone staring at "Started" with nothing to do.
 */
const WAITING_COPY: Record<string, string> = {
  created:
    "You started verification but we have not seen it finish. If you already completed it, choose Refresh status — we will check directly with the provider.",
  pending:
    "Verification is in progress. Finish it in the verification window, then choose Refresh status.",
  needs_review:
    "Your documents are being reviewed by the identity provider. This usually takes a few minutes and needs nothing from you — choose Refresh status to check.",
  failed:
    "That verification did not complete. You can start a new one — nothing else on your application is affected.",
  declined:
    "The provider could not verify that attempt. You can try again with a different document, or your banker can help.",
  expired:
    "That verification link expired. Start a new one — it only takes a couple of minutes.",
};

const GENERIC_START_ERROR =
  "We could not start identity verification. Please try again, or contact your banker if this keeps happening.";

export function IdentityVerificationPanel({ token }: { token: string }) {
  const [owners, setOwners] = useState<OwnerKycStatus[]>([]);
  const [ownership, setOwnership] = useState<OwnershipSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [showOwners, setShowOwners] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/borrower/portal/${token}/identity`);
      const json = await res.json().catch(() => null);
      if (res.ok && json?.ok && Array.isArray(json.owners)) {
        setOwners(json.owners);
        setOwnership(json.ownership ?? null);
        setLoadFailed(false);
      } else {
        // A failed read is NOT an empty owner list. Rendering "no owners
        // require verification" here tells the borrower a hard SBA
        // requirement does not apply to them.
        setLoadFailed(true);
      }
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const startVerification = useCallback(async (ownershipEntityId: string) => {
    setBusy(ownershipEntityId);
    setStartError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/borrower/portal/${token}/identity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownershipEntityId, action: "start" }),
      });
      // `res.json()` itself rejects when the handler 500s with a non-JSON
      // body, which is how a vendor failure previously reached the catch
      // below and vanished. Never let a start failure be silent: the
      // borrower cannot seal the package without this step, so a button
      // that quietly does nothing is a dead end with no way out.
      const json = await res.json().catch(() => null);
      if (res.ok && json?.ok && json.sessionUrl) {
        window.open(json.sessionUrl, "_blank", "noopener,noreferrer");
        await load();
        return;
      }
      setStartError(typeof json?.message === "string" ? json.message : GENERIC_START_ERROR);
    } catch {
      setStartError(GENERIC_START_ERROR);
    } finally {
      setBusy(null);
    }
  }, [token, load]);

  /**
   * Ask the server to re-read this owner's status straight from the
   * identity provider. This is the control whose absence stranded the
   * 2026-08-25 borrower: their verification was Approved at Didit the
   * whole time, and nothing in the product would go and look.
   */
  const refreshStatus = useCallback(async (ownershipEntityId: string) => {
    setBusy(ownershipEntityId);
    setStartError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/borrower/portal/${token}/identity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownershipEntityId, action: "refresh" }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.ok) {
        await load();
        setNotice(
          json.changed
            ? "Status updated."
            : "No change yet — the provider still shows this as unfinished. Try Continue to pick up where you left off.",
        );
        return;
      }
      setStartError(
        typeof json?.message === "string"
          ? json.message
          : "We could not check your status just now. Please try again in a moment.",
      );
    } catch {
      setStartError("We could not check your status just now. Please try again in a moment.");
    } finally {
      setBusy(null);
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

  if (loadFailed) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-rose-700">
          We could not load identity verification status.
        </p>
        <button
          type="button"
          onClick={() => { setLoading(true); void load(); }}
          className="text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 min-h-[32px]"
        >
          Try again
        </button>
      </div>
    );
  }

  const allVerified = owners.length > 0 && owners.every((o) => o.verified);
  const ownershipBroken = ownership !== null && !ownership.valid;

  return (
    <div className="space-y-3">
      {startError && (
        <div
          role="alert"
          className="bg-rose-50 border border-rose-200 rounded-lg px-4 py-3 text-sm text-rose-700"
        >
          {startError}
        </div>
      )}

      {notice && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-sm text-slate-700">
          {notice}
        </div>
      )}

      {/*
        A 149%-total owner list makes the sealing gate unsatisfiable no
        matter how many verifications pass, so it is surfaced here — at the
        point where the borrower is being asked to verify people — rather
        than left to be discovered as an unexplained blocked Submit button.
      */}
      {ownershipBroken && (
        <div role="alert" className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
          <p className="font-medium">
            Your owner list adds up to {ownership!.total}%, not 100%.
          </p>
          <p className="mt-1 text-xs">
            Every owner at 20% or more has to verify their identity, so an extra or
            duplicated owner will hold up your application. Fix the list and this
            section updates straight away.
          </p>
          <button
            type="button"
            onClick={() => setShowOwners((v) => !v)}
            className="mt-2 text-xs font-medium px-3 py-1.5 rounded-lg border border-amber-300 text-amber-900 hover:bg-amber-100 min-h-[32px]"
          >
            {showOwners ? "Hide owner list" : "Fix owner list"}
          </button>
        </div>
      )}

      {allVerified && !ownershipBroken && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-sm text-emerald-700">
          All owners have completed identity verification.
        </div>
      )}

      {owners.map((o) => {
        const v = o.verification;
        const statusKey = v?.status ?? null;
        const status = statusKey
          ? (STATUS_DISPLAY[statusKey] ?? { label: statusKey, cls: "text-slate-700 bg-slate-50" })
          : null;
        const waiting = !o.verified && statusKey ? WAITING_COPY[statusKey] ?? null : null;
        const isBusy = busy === o.ownershipEntityId;

        return (
          <div key={o.ownershipEntityId} className="border border-slate-200 rounded-lg px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-800">{o.displayName}</p>
                <p className="text-xs text-slate-500">{o.ownershipPct}% owner</p>
              </div>
              <div className="flex items-center gap-2 flex-wrap justify-end">
                {status && (
                  <span className={`text-xs font-medium px-2 py-1 rounded-full ${status.cls}`}>
                    {status.label}
                  </span>
                )}
                {!v && (
                  <span className="text-xs font-medium px-2 py-1 rounded-full text-slate-700 bg-slate-50">
                    Not started
                  </span>
                )}

                {o.actions.canStart && (
                  <button
                    type="button"
                    onClick={() => startVerification(o.ownershipEntityId)}
                    disabled={isBusy}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg brand-gradient-cta text-white hover:brightness-110 disabled:opacity-50 min-h-[32px]"
                  >
                    {isBusy ? "Starting..." : v ? "Try again" : "Verify ID"}
                  </button>
                )}

                {o.actions.canResume && v?.sessionUrl && (
                  <a
                    href={v.sessionUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-medium px-3 py-1.5 rounded-lg border border-blue-300 text-blue-700 hover:bg-blue-50 min-h-[32px] inline-flex items-center"
                  >
                    Continue
                  </a>
                )}

                {o.actions.canRefresh && (
                  <button
                    type="button"
                    onClick={() => refreshStatus(o.ownershipEntityId)}
                    disabled={isBusy}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50 min-h-[32px]"
                  >
                    {isBusy ? "Checking..." : "Refresh status"}
                  </button>
                )}
              </div>
            </div>

            {waiting && (
              <p className="mt-2 text-xs text-slate-600">{waiting}</p>
            )}
          </div>
        );
      })}

      {owners.length === 0 && !ownershipBroken && (
        <p className="text-sm text-slate-500">
          No owners require identity verification at this time.
        </p>
      )}

      {(showOwners || (ownershipBroken && owners.length === 0)) && (
        <div className="border-t border-slate-200 pt-3">
          <h4 className="mb-2 text-sm font-medium text-slate-700">Owners on file</h4>
          <OwnershipEditor token={token} onChanged={() => { void load(); }} />
        </div>
      )}

      {!ownershipBroken && (
        <button
          type="button"
          onClick={() => setShowOwners((v) => !v)}
          className="text-xs font-medium text-slate-500 hover:text-slate-700 underline underline-offset-2"
        >
          {showOwners ? "Hide owner list" : "Owner list looks wrong?"}
        </button>
      )}
    </div>
  );
}
