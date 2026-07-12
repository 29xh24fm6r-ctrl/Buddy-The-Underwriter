"use client";

/**
 * SPEC S5 B-6 — bank-admin panel to configure/rotate SBA E-Tran mutual-TLS
 * credentials. Displayed metadata is intentionally limited to what
 * /api/banks/[bankId]/etran/credentials GET returns — never the PEM
 * contents (the API never sends them back down).
 */

import { useEffect, useState } from "react";

type CredentialMeta = {
  sba_lender_id: string;
  sba_service_center: string;
  endpoint_environment: "sandbox" | "production";
  cert_expires_at: string | null;
  last_rotation_at: string | null;
  updated_at: string;
};

export default function EtranCredentialAdminPanel({ bankId }: { bankId: string }) {
  const [meta, setMeta] = useState<CredentialMeta | null>(null);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const [sbaLenderId, setSbaLenderId] = useState("");
  const [sbaServiceCenter, setSbaServiceCenter] = useState("");
  const [clientCertPem, setClientCertPem] = useState("");
  const [clientKeyPem, setClientKeyPem] = useState("");
  const [endpointEnvironment, setEndpointEnvironment] = useState<"sandbox" | "production">("sandbox");
  const [certExpiresAt, setCertExpiresAt] = useState("");

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/banks/${bankId}/etran/credentials`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setConfigured(!!json.configured);
      setMeta(json.credentials ?? null);
    } catch (e: any) {
      setToast(e?.message || "Failed to load E-Tran credential status");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankId]);

  function openForm() {
    setSbaLenderId(meta?.sba_lender_id ?? "");
    setSbaServiceCenter(meta?.sba_service_center ?? "");
    setClientCertPem("");
    setClientKeyPem("");
    setEndpointEnvironment(meta?.endpoint_environment ?? "sandbox");
    setCertExpiresAt("");
    setFormOpen(true);
  }

  async function save() {
    if (!sbaLenderId.trim() || !sbaServiceCenter.trim() || !clientCertPem.trim() || !clientKeyPem.trim()) {
      setToast("Lender ID, service center, and both PEM fields are required.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/banks/${bankId}/etran/credentials`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sba_lender_id: sbaLenderId.trim(),
          sba_service_center: sbaServiceCenter.trim(),
          client_cert_pem: clientCertPem,
          client_key_pem: clientKeyPem,
          endpoint_environment: endpointEnvironment,
          cert_expires_at: certExpiresAt || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setToast("E-Tran credentials saved.");
      setFormOpen(false);
      await load();
    } catch (e: any) {
      setToast(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="p-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold text-slate-900">SBA E-Tran Credentials</div>
          <div className="text-sm text-slate-600">
            Mutual-TLS client certificate used to submit applications to SBA E-Tran. Stored encrypted at rest.
          </div>
        </div>
        <div className="flex items-center gap-2">
          {toast && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
              {toast}
            </div>
          )}
          <button
            onClick={openForm}
            className="rounded-xl border border-slate-200 bg-slate-900 px-3 py-2 text-xs font-semibold text-white"
          >
            {configured ? "Rotate Credentials" : "Configure"}
          </button>
        </div>
      </div>

      <div className="px-4 pb-4">
        {loading ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">Loading…</div>
        ) : !configured ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            No E-Tran credentials configured for this bank yet. Applications cannot be submitted to SBA until this is set up.
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 space-y-1">
            <div>Lender ID: <span className="font-mono">{meta?.sba_lender_id}</span></div>
            <div>Service Center: <span className="font-mono">{meta?.sba_service_center}</span></div>
            <div>
              Environment:{" "}
              <span
                className={
                  meta?.endpoint_environment === "production"
                    ? "rounded-lg bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700"
                    : "rounded-lg bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700"
                }
              >
                {meta?.endpoint_environment}
              </span>
            </div>
            {meta?.cert_expires_at && <div>Certificate expires: {new Date(meta.cert_expires_at).toLocaleDateString()}</div>}
            {meta?.last_rotation_at && <div>Last rotated: {new Date(meta.last_rotation_at).toLocaleString()}</div>}
          </div>
        )}
      </div>

      {formOpen && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/30" onClick={() => setFormOpen(false)} />
          <div className="absolute inset-x-0 top-16 mx-auto w-full max-w-2xl bg-white shadow-2xl rounded-2xl border border-slate-200">
            <div className="p-4 border-b border-slate-200 flex items-start justify-between">
              <div>
                <div className="text-base font-semibold text-slate-900">
                  {configured ? "Rotate E-Tran Credentials" : "Configure E-Tran Credentials"}
                </div>
                <div className="text-xs text-slate-600 mt-1">
                  PEM contents are encrypted at rest and never displayed again after saving.
                </div>
              </div>
              <button
                onClick={() => setFormOpen(false)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
            </div>

            <div className="p-4 space-y-3">
              <div>
                <div className="text-xs font-semibold text-slate-700 mb-1">SBA Lender ID</div>
                <input
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  value={sbaLenderId}
                  onChange={(e) => setSbaLenderId(e.target.value)}
                />
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-700 mb-1">SBA Service Center</div>
                <input
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  value={sbaServiceCenter}
                  onChange={(e) => setSbaServiceCenter(e.target.value)}
                />
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-700 mb-1">Environment</div>
                <select
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  value={endpointEnvironment}
                  onChange={(e) => setEndpointEnvironment(e.target.value as "sandbox" | "production")}
                >
                  <option value="sandbox">Sandbox</option>
                  <option value="production">Production</option>
                </select>
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-700 mb-1">Client Certificate (PEM)</div>
                <textarea
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-mono"
                  rows={4}
                  placeholder="-----BEGIN CERTIFICATE-----"
                  value={clientCertPem}
                  onChange={(e) => setClientCertPem(e.target.value)}
                />
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-700 mb-1">Client Private Key (PEM)</div>
                <textarea
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-mono"
                  rows={4}
                  placeholder="-----BEGIN PRIVATE KEY-----"
                  value={clientKeyPem}
                  onChange={(e) => setClientKeyPem(e.target.value)}
                />
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-700 mb-1">Certificate Expires (optional)</div>
                <input
                  type="date"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  value={certExpiresAt}
                  onChange={(e) => setCertExpiresAt(e.target.value)}
                />
              </div>
            </div>

            <div className="p-4 border-t border-slate-200 flex justify-end gap-2">
              <button
                onClick={() => setFormOpen(false)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="rounded-xl border border-slate-200 bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
