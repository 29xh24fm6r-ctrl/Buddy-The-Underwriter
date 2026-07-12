"use client";

/**
 * SPEC S3 C-1 — per-owner-per-form IAL2 + signature status table in the
 * Story tab. "Send for signature" is disabled until IAL2 is verified —
 * the same hard gate service.ts enforces server-side, mirrored here so
 * the UI doesn't invite a request that will just come back 403.
 */

import { useCallback, useEffect, useState } from "react";

type FormStatus = { signed: boolean; expiresAt: string | null };
type SigningRow = {
  ownershipEntityId: string;
  displayName: string | null;
  ial2Status: "verified" | "pending" | "declined" | "not_started";
  forms: Record<string, FormStatus>;
};

const TRACKED_FORMS = [
  { code: "FORM_1919", label: "Form 1919" },
  { code: "FORM_413", label: "Form 413" },
] as const;

const IAL2_LABEL: Record<SigningRow["ial2Status"], string> = {
  verified: "✓ Verified",
  pending: "⏳ Pending",
  declined: "✗ Declined",
  not_started: "Not started",
};

export default function SbaSigningPanel({ dealId }: { dealId: string }) {
  const [rows, setRows] = useState<SigningRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/deals/${dealId}/sba/signing-status`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) setRows(data.rows ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [dealId]);

  useEffect(() => {
    load();
  }, [load]);

  const startVerification = useCallback(
    async (ownershipEntityId: string) => {
      const key = `kyc:${ownershipEntityId}`;
      setBusyKey(key);
      try {
        const res = await fetch(`/api/deals/${dealId}/kyc/initiate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ownership_entity_id: ownershipEntityId }),
        });
        const data = await res.json();
        if (data.ok && data.oneTimeLink) {
          window.open(data.oneTimeLink, "_blank", "noopener,noreferrer");
        }
        load();
      } finally {
        setBusyKey(null);
      }
    },
    [dealId, load],
  );

  const sendForSignature = useCallback(
    async (ownershipEntityId: string, formCode: string) => {
      const key = `esign:${ownershipEntityId}:${formCode}`;
      setBusyKey(key);
      try {
        const res = await fetch(`/api/deals/${dealId}/esign/request`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            form_code: formCode,
            template_version: "v1",
            signer_ownership_entity_id: ownershipEntityId,
            signer_role: "applicant",
            signer_email: "",
            signer_name: "",
          }),
        });
        const data = await res.json();
        if (data.ok && data.embed_url) {
          window.open(data.embed_url, "_blank", "noopener,noreferrer");
        }
        load();
      } finally {
        setBusyKey(null);
      }
    },
    [dealId, load],
  );

  const glassSection = "rounded-xl border border-white/8 bg-white/[0.02] p-4";
  const sectionLabel = "text-[10px] font-bold uppercase tracking-widest text-white/40 mb-3";

  if (loading) {
    return (
      <div className={glassSection}>
        <div className={sectionLabel}>SBA Signing Status</div>
        <div className="h-16 rounded-lg bg-white/5 animate-pulse" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className={glassSection}>
        <div className={sectionLabel}>SBA Signing Status</div>
        <p className="text-xs text-white/40">No individual owners on file yet.</p>
      </div>
    );
  }

  return (
    <div className={glassSection}>
      <div className={sectionLabel}>SBA Signing Status</div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-white/40">
              <th className="pb-2 pr-3 font-semibold">Owner</th>
              <th className="pb-2 pr-3 font-semibold">IAL2 Status</th>
              {TRACKED_FORMS.map((f) => (
                <th key={f.code} className="pb-2 pr-3 font-semibold">
                  {f.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const verified = row.ial2Status === "verified";
              return (
                <tr key={row.ownershipEntityId} className="border-t border-white/8">
                  <td className="py-2 pr-3 text-white/80">{row.displayName ?? row.ownershipEntityId.slice(0, 8)}</td>
                  <td className="py-2 pr-3 text-white/60">
                    {IAL2_LABEL[row.ial2Status]}
                    {row.ial2Status !== "verified" && (
                      <button
                        type="button"
                        onClick={() => startVerification(row.ownershipEntityId)}
                        disabled={busyKey === `kyc:${row.ownershipEntityId}`}
                        className="ml-2 rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-white/60 hover:bg-white/10 disabled:opacity-40"
                      >
                        Start ID verification
                      </button>
                    )}
                  </td>
                  {TRACKED_FORMS.map((f) => {
                    const status = row.forms[f.code];
                    return (
                      <td key={f.code} className="py-2 pr-3">
                        {status?.signed ? (
                          <span className="text-emerald-400">✓ Signed</span>
                        ) : verified ? (
                          <button
                            type="button"
                            onClick={() => sendForSignature(row.ownershipEntityId, f.code)}
                            disabled={busyKey === `esign:${row.ownershipEntityId}:${f.code}`}
                            className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-white/60 hover:bg-white/10 disabled:opacity-40"
                          >
                            ⏳ Send
                          </button>
                        ) : (
                          <span className="text-white/30" title="Requires IAL2 identity verification first">
                            — Locked
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
