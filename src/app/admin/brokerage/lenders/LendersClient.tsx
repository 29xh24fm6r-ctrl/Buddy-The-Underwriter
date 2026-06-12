"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Lender manager — client side of /admin/brokerage/lenders.
 *
 * Talks to /api/admin/brokerage/lenders (super-admin gated). Supports:
 *   - single-lender form (name + program criteria + agreement terms)
 *   - bulk JSON paste for loading many lenders at once
 *   - listing existing lenders with their program criteria
 *   - offboarding (removes programs, terminates the active agreement)
 *
 * Re-submitting an existing lender updates it — the API is idempotent
 * on bank code — so this same form is also the edit form.
 */

type Lender = {
  bankId: string;
  code: string;
  name: string;
  websiteUrl: string | null;
  isSandbox: boolean;
  agreement: {
    id: string;
    status: string;
    referral_fee_bps: number | null;
    accepts_sba_7a: boolean;
    signed_by_name: string | null;
    signed_at: string | null;
  } | null;
  programs: Array<{
    id: string;
    program_name: string | null;
    min_dscr: number | null;
    max_ltv: number | null;
    asset_types: string[] | null;
    geography: string[] | null;
    sba_only: boolean;
    score_threshold: number | null;
    notes: string | null;
  }>;
};

const EMPTY_FORM = {
  name: "",
  websiteUrl: "",
  programName: "SBA 7(a)",
  minDscr: "1.25",
  maxLtv: "",
  geography: "NATIONWIDE",
  assetTypes: "",
  scoreThreshold: "60",
  sbaOnly: true,
  referralFeeBps: "100",
  signedByName: "",
  notes: "",
};

export default function LendersClient() {
  const [lenders, setLenders] = useState<Lender[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [bulkJson, setBulkJson] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/brokerage/lenders", { cache: "no-store" });
      const data = await res.json();
      if (data?.ok) setLenders(data.lenders ?? []);
      else setMessage({ kind: "err", text: data?.error ?? "Failed to load lenders" });
    } catch (e) {
      setMessage({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function set<K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submitOne() {
    if (!form.name.trim()) {
      setMessage({ kind: "err", text: "Lender name is required" });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/brokerage/lenders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          websiteUrl: form.websiteUrl || null,
          program: {
            programName: form.programName,
            minDscr: form.minDscr,
            maxLtv: form.maxLtv,
            geography: form.geography,
            assetTypes: form.assetTypes,
            sbaOnly: form.sbaOnly,
            scoreThreshold: form.scoreThreshold,
            notes: form.notes,
          },
          agreement: {
            referralFeeBps: form.referralFeeBps,
            acceptsSba7a: true,
            signedByName: form.signedByName,
          },
        }),
      });
      const data = await res.json();
      if (data?.ok) {
        setMessage({ kind: "ok", text: `Loaded ${form.name}` });
        setForm({ ...EMPTY_FORM });
        void refresh();
      } else {
        const firstErr = data?.results?.find((r: any) => !r.ok)?.error ?? data?.error;
        setMessage({ kind: "err", text: firstErr ?? "Load failed" });
      }
    } catch (e) {
      setMessage({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function submitBulk() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(bulkJson);
    } catch {
      setMessage({ kind: "err", text: "Bulk input is not valid JSON" });
      return;
    }
    const lendersArr = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as any)?.lenders)
        ? (parsed as any).lenders
        : null;
    if (!lendersArr) {
      setMessage({ kind: "err", text: "Provide a JSON array of lenders, or { \"lenders\": [...] }" });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/brokerage/lenders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lenders: lendersArr }),
      });
      const data = await res.json();
      const failed = (data?.results ?? []).filter((r: any) => !r.ok);
      if (data?.ok) {
        setMessage({ kind: "ok", text: `Loaded ${data.loaded} lender(s)` });
        setBulkJson("");
      } else {
        setMessage({
          kind: "err",
          text: `Loaded ${data?.loaded ?? 0}, failed ${failed.length}: ${failed
            .map((r: any) => r.error)
            .slice(0, 3)
            .join("; ")}`,
        });
      }
      void refresh();
    } catch (e) {
      setMessage({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function offboard(lender: Lender) {
    if (!window.confirm(`Offboard ${lender.name}? Programs are removed and the active agreement is terminated. History is kept.`)) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/brokerage/lenders?bankId=${encodeURIComponent(lender.bankId)}`, { method: "DELETE" });
      const data = await res.json();
      if (data?.ok) setMessage({ kind: "ok", text: `Offboarded ${lender.name}` });
      else setMessage({ kind: "err", text: data?.error ?? "Offboard failed" });
      void refresh();
    } catch (e) {
      setMessage({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-neutral-400 focus:outline-none";
  const labelCls = "block text-xs uppercase tracking-wide text-neutral-400 mb-1";

  return (
    <div className="space-y-10">
      {message && (
        <div
          className={`rounded border p-3 text-sm ${
            message.kind === "ok"
              ? "border-emerald-700 bg-emerald-900/30 text-emerald-200"
              : "border-red-700 bg-red-900/30 text-red-200"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* ── Add / update one lender ── */}
      <section className="rounded-md border border-neutral-800 bg-neutral-900 p-5">
        <h2 className="text-lg font-semibold mb-1">Add a lender</h2>
        <p className="text-xs text-neutral-500 mb-4">
          Creates the bank identity, a matching program, and an active marketplace agreement.
          Submitting an existing lender name updates it.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <label className={labelCls}>Lender name *</label>
            <input className={inputCls} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="First Community Bank of Texas" />
          </div>
          <div>
            <label className={labelCls}>Website</label>
            <input className={inputCls} value={form.websiteUrl} onChange={(e) => set("websiteUrl", e.target.value)} placeholder="https://..." />
          </div>

          <div>
            <label className={labelCls}>Program name</label>
            <input className={inputCls} value={form.programName} onChange={(e) => set("programName", e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Min DSCR</label>
            <input className={inputCls} value={form.minDscr} onChange={(e) => set("minDscr", e.target.value)} placeholder="1.25" inputMode="decimal" />
          </div>
          <div>
            <label className={labelCls}>Score threshold (0-100)</label>
            <input className={inputCls} value={form.scoreThreshold} onChange={(e) => set("scoreThreshold", e.target.value)} placeholder="60" inputMode="numeric" />
          </div>

          <div>
            <label className={labelCls}>Geography (comma-separated)</label>
            <input className={inputCls} value={form.geography} onChange={(e) => set("geography", e.target.value)} placeholder="NATIONWIDE or TX, OK, LA" />
          </div>
          <div>
            <label className={labelCls}>Asset types (comma-separated)</label>
            <input className={inputCls} value={form.assetTypes} onChange={(e) => set("assetTypes", e.target.value)} placeholder="equipment, real_estate, business_acquisition" />
          </div>
          <div>
            <label className={labelCls}>Max LTV (decimal, optional)</label>
            <input className={inputCls} value={form.maxLtv} onChange={(e) => set("maxLtv", e.target.value)} placeholder="0.85" inputMode="decimal" />
          </div>

          <div>
            <label className={labelCls}>Referral fee (bps)</label>
            <input className={inputCls} value={form.referralFeeBps} onChange={(e) => set("referralFeeBps", e.target.value)} placeholder="100" inputMode="numeric" />
          </div>
          <div>
            <label className={labelCls}>Agreement signed by</label>
            <input className={inputCls} value={form.signedByName} onChange={(e) => set("signedByName", e.target.value)} placeholder="Jane Smith, EVP" />
          </div>
          <div className="flex items-end pb-2">
            <label className="inline-flex items-center gap-2 text-sm text-neutral-300">
              <input type="checkbox" checked={form.sbaOnly} onChange={(e) => set("sbaOnly", e.target.checked)} className="h-4 w-4" />
              SBA-only lender
            </label>
          </div>

          <div className="md:col-span-3">
            <label className={labelCls}>Notes</label>
            <input className={inputCls} value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Prefers deals under $2M; fast on equipment." />
          </div>
        </div>

        <button
          onClick={() => void submitOne()}
          disabled={busy}
          className="mt-5 rounded bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-50"
        >
          {busy ? "Working..." : "Load lender"}
        </button>
      </section>

      {/* ── Bulk load ── */}
      <section className="rounded-md border border-neutral-800 bg-neutral-900 p-5">
        <h2 className="text-lg font-semibold mb-1">Bulk load (JSON)</h2>
        <p className="text-xs text-neutral-500 mb-3">
          Paste an array of lenders. Each item: {`{ "name": "...", "program": { "minDscr": 1.25, "geography": ["TX"], "scoreThreshold": 60 }, "agreement": { "referralFeeBps": 100, "signedByName": "..." } }`}
        </p>
        <textarea
          className={`${inputCls} h-40 font-mono text-xs`}
          value={bulkJson}
          onChange={(e) => setBulkJson(e.target.value)}
          placeholder='[ { "name": "First Community Bank of Texas", "program": { "minDscr": 1.25, "geography": ["TX"], "scoreThreshold": 60 } } ]'
        />
        <button
          onClick={() => void submitBulk()}
          disabled={busy || bulkJson.trim().length === 0}
          className="mt-3 rounded border border-neutral-600 px-4 py-2 text-sm font-medium text-neutral-200 hover:border-neutral-400 disabled:opacity-50"
        >
          {busy ? "Working..." : "Bulk load"}
        </button>
      </section>

      {/* ── Existing lenders ── */}
      <section>
        <h2 className="text-lg font-semibold mb-3">
          Loaded lenders {loading ? "" : `(${lenders.length})`}
        </h2>
        {loading ? (
          <p className="text-sm text-neutral-500">Loading...</p>
        ) : lenders.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No lenders loaded yet. The marketplace can&apos;t match listings until at least one
            lender with an active agreement exists.
          </p>
        ) : (
          <div className="space-y-3">
            {lenders.map((l) => (
              <div key={l.bankId} className="rounded-md border border-neutral-800 bg-neutral-900 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="font-medium text-neutral-100">
                      {l.name}
                      {l.isSandbox && (
                        <span className="ml-2 rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-300">
                          sandbox
                        </span>
                      )}
                      {l.agreement ? (
                        <span className="ml-2 rounded bg-emerald-900/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-emerald-300">
                          agreement active · {l.agreement.referral_fee_bps ?? "—"} bps
                        </span>
                      ) : (
                        <span className="ml-2 rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-400">
                          no active agreement
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-neutral-500 mt-0.5">
                      <code>{l.code}</code>
                      {l.agreement?.signed_by_name ? ` · signed by ${l.agreement.signed_by_name}` : ""}
                    </div>
                    {l.programs.map((p) => (
                      <div key={p.id} className="text-xs text-neutral-400 mt-2">
                        <span className="text-neutral-300">{p.program_name ?? "Program"}:</span>{" "}
                        {p.min_dscr != null ? `DSCR ≥ ${p.min_dscr}` : "any DSCR"}
                        {p.score_threshold != null ? ` · score ≥ ${p.score_threshold}` : ""}
                        {p.geography?.length ? ` · ${p.geography.join(", ")}` : " · all geographies"}
                        {p.asset_types?.length ? ` · ${p.asset_types.join(", ")}` : ""}
                        {p.sba_only ? " · SBA only" : ""}
                        {p.notes ? ` · ${p.notes}` : ""}
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => void offboard(l)}
                    disabled={busy}
                    className="shrink-0 rounded border border-red-900 px-3 py-1.5 text-xs text-red-300 hover:border-red-600 disabled:opacity-50"
                  >
                    Offboard
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
