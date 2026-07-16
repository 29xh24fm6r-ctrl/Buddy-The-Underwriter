"use client";

/**
 * Ticket 2 follow-up — borrower-facing e-signature trigger. Mirrors the
 * Underwriter tenant's SbaSigningPanel.tsx (owner x form grid, "Send" opens
 * DocuSeal's embed URL in a new tab), generic on form_code same as the
 * underlying /borrower-actions/esign action — it does not depend on
 * Brokerage's own SBA form-generation pipeline (src/lib/brokerage/
 * borrowerFormsOrchestration.ts), since DocuSeal signs against its own
 * pre-configured template per form code, not a generated reference PDF
 * (see the T7 AAR). Functions identically whether DocuSeal is real or the
 * mock-vendor test harness is active — the server decides that
 * transparently; this component has no test-mode-specific branching.
 *
 * Visibility: rendered once at least one owner has completed IAL2 (the
 * hard server-side gate, enforced in requestSignature/mockRequestSignature
 * regardless of what this UI shows). Documented default sequencing
 * decision was "e-signature after pick" (T5 AAR) — that's a UI-visibility
 * preference, not a server-enforced rule, so this panel doesn't hide
 * itself pre-pick; it just won't produce anything signable until IAL2 is
 * verified, same invariant the server already owns.
 */

import { useCallback, useEffect, useState } from "react";

type OwnerRow = {
  ownershipEntityId: string;
  displayName: string | null;
  ial2Status: "verified" | "pending" | "declined" | "not_started";
};

type FormStatus = { signed: boolean; submissionId: string | null };

const TRACKED_FORMS = [
  { code: "SBA_1919", label: "Form 1919" },
  { code: "SBA_413", label: "Form 413 (PFS)" },
  { code: "SBA_912", label: "Form 912" },
  { code: "IRS_4506C", label: "Form 4506-C" },
] as const;

export function SigningPanel({ dealId }: { dealId: string }) {
  const [owners, setOwners] = useState<OwnerRow[]>([]);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [formStatus, setFormStatus] = useState<Record<string, FormStatus>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/brokerage/deals/${dealId}/borrower-actions/kyc`, {
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        setOwners(data.owners ?? []);
        setSessionEmail(data.sessionEmail ?? null);
      }
    } catch {
      // non-fatal — keep showing last known state
    }
  }, [dealId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll pending submissions so a signature completed in the other tab
  // (real DocuSeal, or the mock-vendor test harness's confirmation page)
  // flips this panel to "signed" without the borrower needing to reload.
  useEffect(() => {
    const pending = Object.entries(formStatus).filter(([, s]) => s.submissionId && !s.signed);
    if (pending.length === 0) return;

    const timer = window.setInterval(async () => {
      for (const [key, s] of pending) {
        if (!s.submissionId) continue;
        try {
          const res = await fetch(
            `/api/brokerage/deals/${dealId}/borrower-actions/esign?submissionId=${encodeURIComponent(s.submissionId)}`,
            { credentials: "include" },
          );
          const data = await res.json().catch(() => ({}));
          if (data.ok && data.status === "completed") {
            setFormStatus((prev) => ({ ...prev, [key]: { ...prev[key], signed: true } }));
          }
        } catch {
          // non-fatal — try again next tick
        }
      }
    }, 4000);
    return () => window.clearInterval(timer);
  }, [dealId, formStatus]);

  const sendForSignature = useCallback(
    async (owner: OwnerRow, formCode: string) => {
      const key = `${owner.ownershipEntityId}:${formCode}`;
      setBusyKey(key);
      setError(null);
      try {
        const res = await fetch(`/api/brokerage/deals/${dealId}/borrower-actions/esign`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            form_code: formCode,
            template_version: "v1",
            signer_ownership_entity_id: owner.ownershipEntityId,
            signer_role: "applicant",
            signer_email: sessionEmail ?? "",
            signer_name: owner.displayName ?? "Borrower",
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!data.ok) {
          setError(
            data.error === "IAL2_NOT_COMPLETED"
              ? "Identity verification must complete before signing."
              : data.error === "docuseal_template_not_configured"
                ? "This form isn't ready to sign yet — check back soon."
                : "Could not start signing.",
          );
        } else {
          setFormStatus((prev) => ({ ...prev, [key]: { signed: false, submissionId: data.submission_id } }));
          if (data.embed_url) {
            window.open(data.embed_url, "_blank", "noopener,noreferrer");
          }
        }
      } catch {
        setError("Network error");
      } finally {
        setBusyKey(null);
      }
    },
    [dealId, sessionEmail],
  );

  const verifiedOwners = owners.filter((o) => o.ial2Status === "verified");
  if (verifiedOwners.length === 0) return null;

  return (
    <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-semibold text-slate-900 mb-2">Sign your forms</h3>
      <p className="text-sm text-slate-600 mb-4">
        Once you sign, Buddy sends the signed copy to your lender. Each form opens in a new tab.
      </p>
      <div className="space-y-3">
        {verifiedOwners.map((owner) => (
          <div key={owner.ownershipEntityId} className="rounded-lg border border-slate-200 p-3">
            <p className="text-sm font-medium text-slate-800 mb-2">{owner.displayName ?? "Owner"}</p>
            <ul className="flex flex-wrap gap-2">
              {TRACKED_FORMS.map((f) => {
                const key = `${owner.ownershipEntityId}:${f.code}`;
                const status = formStatus[key];
                return (
                  <li key={f.code}>
                    {status?.signed ? (
                      <span className="text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-1 rounded">
                        ✓ {f.label} signed
                      </span>
                    ) : (
                      <button
                        onClick={() => sendForSignature(owner, f.code)}
                        disabled={busyKey === key}
                        type="button"
                        className="text-xs font-medium text-slate-700 border border-slate-200 px-2 py-1 rounded hover:bg-slate-50 disabled:opacity-50"
                      >
                        {busyKey === key ? "Opening…" : `Sign ${f.label}`}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
    </div>
  );
}
