"use client";

import { useEffect, useState } from "react";
import { DrawerShell } from "./DrawerShell";
import type { BorrowerCard } from "@/lib/builder/builderTypes";

type Props = {
  open: boolean;
  onClose: () => void;
  owner: BorrowerCard | null;
  dealId: string;
};

export function EntityProfileDrawer({ open, onClose, owner, dealId }: Props) {
  if (!owner) return null;

  return (
    <DrawerShell open={open} onClose={onClose} title="Entity Profile">
      <div className="space-y-4">
        <div className="text-sm font-semibold text-white">Core Info</div>
        <div className="space-y-2 text-sm">
          <Row label="Name" value={owner.full_legal_name} />
          <Row label="Title" value={owner.title} />
          <Row label="Ownership" value={owner.ownership_pct != null ? `${owner.ownership_pct}%` : undefined} />
          <Row label="DOB" value={owner.dob} />
          <Row label="SSN Last 4" value={owner.ssn_last4 ? `***-**-${owner.ssn_last4}` : undefined} />
          <Row label="Address" value={[owner.home_address, owner.home_city, owner.home_state, owner.home_zip].filter(Boolean).join(", ") || undefined} />
          <Row label="Years w/ Company" value={owner.years_with_company != null ? String(owner.years_with_company) : undefined} />
          <Row label="Credit Auth" value={owner.credit_auth_obtained ? "Yes" : "No"} />
        </div>
      </div>

      <div className="border-t border-white/10 pt-4">
        <div className="text-sm font-semibold text-white mb-2">Secure Info</div>
        <SsnCapture dealId={dealId} ownershipEntityId={owner.ownership_entity_id} />
      </div>
    </DrawerShell>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-center justify-between border-b border-white/5 pb-1">
      <span className="text-white/50">{label}</span>
      <span className="text-white">{value || "—"}</span>
    </div>
  );
}

type PiiStatus = { ssnOnFile: boolean; ssnLast4: string | null };

/**
 * Full SSN is required on Forms 912/413/4506-C, but nothing in the
 * builder UI ever collected/wrote it — OwnerDrawer only captures
 * ssn_last4, and /api/deals/[dealId]/builder/pii (the encrypted vault
 * endpoint) had no caller anywhere. This is that caller. Only ever
 * displays presence + last4 (never the decrypted value) and clears the
 * typed value from local state immediately after a successful submit.
 */
function SsnCapture({ dealId, ownershipEntityId }: { dealId: string; ownershipEntityId?: string }) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [pii, setPii] = useState<PiiStatus | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftSsn, setDraftSsn] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!ownershipEntityId) return;
    let cancelled = false;
    setStatus("loading");
    fetch(`/api/deals/${dealId}/builder/pii?ownershipEntityId=${ownershipEntityId}`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (json.ok) {
          setPii({ ssnOnFile: json.ssnOnFile, ssnLast4: json.ssnLast4 });
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
  }, [dealId, ownershipEntityId]);

  if (!ownershipEntityId) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-white/40">
        Save this owner&apos;s name first — full SSN capture unlocks once the owner is on file.
      </div>
    );
  }

  if (status === "loading") {
    return <div className="text-xs text-white/40">Loading…</div>;
  }
  if (status === "error") {
    return <div className="text-xs text-rose-400">Couldn&apos;t load SSN status.</div>;
  }

  const digits = draftSsn.replace(/\D/g, "");

  async function handleSubmit() {
    if (digits.length !== 9) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/builder/pii`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownershipEntityId, piiType: "full_ssn", plaintext: digits }),
      });
      const json = await res.json();
      if (res.ok && json.ok) {
        setPii({ ssnOnFile: true, ssnLast4: json.last4 });
        setEditing(false);
        setDraftSsn("");
      } else {
        setSubmitError(json.error ?? "Failed to save.");
      }
    } catch {
      setSubmitError("Failed to save.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
        <div className="text-sm text-white">
          Full SSN:{" "}
          {pii?.ssnOnFile ? (
            <span className="text-emerald-400">on file (•••-••-{pii.ssnLast4})</span>
          ) : (
            <span className="text-white/40">not on file</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-xs text-primary hover:underline"
        >
          {pii?.ssnOnFile ? "Update" : "Add"}
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 space-y-2">
      <label className="text-xs text-white/50 block">Full Social Security Number</label>
      <input
        type="password"
        inputMode="numeric"
        autoComplete="off"
        value={draftSsn}
        onChange={(e) => setDraftSsn(e.target.value)}
        placeholder="XXX-XX-XXXX"
        maxLength={11}
        className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-white/25 focus:outline-none"
      />
      {submitError && <div className="text-xs text-rose-400">{submitError}</div>}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => { setEditing(false); setDraftSsn(""); setSubmitError(null); }}
          className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-white/70 hover:bg-white/5"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={digits.length !== 9 || submitting}
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-40"
        >
          {submitting ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
