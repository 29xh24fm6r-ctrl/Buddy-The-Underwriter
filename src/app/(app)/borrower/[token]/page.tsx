"use client";

import React, { useEffect, useMemo, useState, use } from "react";
import { SECTIONS, type WizardTrack } from "@/lib/borrowerWizard/schema";
import BorrowerRequirementsCard from "@/components/borrower/BorrowerRequirementsCard";
import BorrowerFormsCard from "@/components/borrower/BorrowerFormsCard";
import BorrowerPreflightCard from "@/components/borrower/BorrowerPreflightCard";
import BorrowerPackageCard from "@/components/borrower/BorrowerPackageCard";
import BorrowerEtranCard from "@/components/borrower/BorrowerEtranCard";
import BorrowerAgentsCard from "@/components/borrower/BorrowerAgentsCard";

type LoadPayload = {
  ok: boolean;
  application?: any;
  answers?: any[];
  applicants?: any[];
  attachments?: any[];
  error?: string;
};

type EligibilityPayload = {
  ok: boolean;
  result?: any;
  error?: string;
};

export default function BorrowerPortal({ params }: { params: Promise<{ token: string }> }) {
    const { token } = use(params);
const [data, setData] = useState<LoadPayload>({ ok: false });
  const [elig, setElig] = useState<EligibilityPayload>({ ok: false });
  const [reqs, setReqs] = useState<any>(null);
  const [forms, setForms] = useState<any>(null);
  const [preflight, setPreflight] = useState<any>(null);
  const [narrative, setNarrative] = useState<any>(null);
  const [pkg, setPkg] = useState<any>(null);
  const [etran, setEtran] = useState<any>(null);
  const [agents, setAgents] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    try {
      const r = await fetch(`/api/borrower/${token}/load`, { method: "GET" });
      const j = await r.json();
      setData(j);
    } finally {
      setBusy(false);
    }
  }

  async function recomputeEligibility() {
    const r = await fetch(`/api/borrower/${token}/eligibility/recompute`, { method: "POST" });
    const j = await r.json();
    setElig(j);
    return j;
  }

  async function recomputeRequirements() {
    const r = await fetch(`/api/borrower/${token}/requirements/recompute`, { method: "POST" });
    const j = await r.json();
    if (j?.ok) setReqs(j);
    return j;
  }

  async function recomputeForms() {
    const r = await fetch(`/api/borrower/${token}/forms/recompute`, { method: "POST" });
    const j = await r.json();
    if (j?.ok) setForms(j);
    return j;
  }

  async function runPreflight() {
    const r = await fetch(`/api/borrower/${token}/preflight/run`, { method: "POST" });
    const j = await r.json();
    if (j?.ok) setPreflight(j);
    return j;
  }

  async function generateNarrative() {
    const r = await fetch(`/api/borrower/${token}/narrative/generate`, { method: "POST" });
    const j = await r.json();
    if (j?.ok) setNarrative(j);
    return j;
  }

  async function buildPackage() {
    const r = await fetch(`/api/borrower/${token}/package/build`, { method: "POST" });
    const j = await r.json();
    if (j?.ok) setPkg(j);
    return j;
  }

  async function checkEtran() {
    const r = await fetch(`/api/borrower/${token}/etran/check`, { method: "POST" });
    const j = await r.json();
    if (j?.ok) setEtran(j);
    return j;
  }

  async function runAgentsCheck() {
    const r = await fetch(`/api/borrower/${token}/agents/run`, { method: "POST" });
    const j = await r.json();
    if (j?.ok) setAgents(j);
    return j;
  }

  async function generatePdf() {
    const r = await fetch(`/api/borrower/${token}/forms/pdf/generate`, { method: "POST" });
    const j = await r.json();
    if (j?.ok) {
      alert(`PDF generated: ${j.form_name}`);
    } else {
      alert(`PDF generation failed: ${j.error}`);
    }
    return j;
  }

  useEffect(() => {
    load().then(() => recomputeEligibility().then(() => recomputeRequirements().then(() => recomputeForms().then(() => runPreflight()))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const answerMap = useMemo(() => {
    const m = new Map<string, any>();
    for (const a of data.answers ?? []) m.set(a.question_key, a.value);
    return m;
  }, [data.answers]);

  const answersObj = useMemo(() => {
    const o: Record<string, any> = {};
    for (const [k, v] of answerMap.entries()) o[k] = v;
    return o;
  }, [answerMap]);

  const track: WizardTrack = useMemo(() => {
    const r = elig.result;
    if (!r) return "UNKNOWN";
    if (r.best_program === "SBA_7A") return "SBA_7A";
    if (r.best_program === "CONVENTIONAL") return "CONVENTIONAL";
    return "UNKNOWN";
  }, [elig.result]);

  async function saveAnswer(section: string, question_key: string, value: any) {
    await fetch(`/api/borrower/${token}/answer/upsert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ section, question_key, value }),
    });
    await load();
    await recomputeEligibility();
    await recomputeRequirements();
    await recomputeForms();
    await runPreflight();
  }

  async function submit() {
    await fetch(`/api/borrower/${token}/submit`, { method: "POST" });
    await load();
  }

  if (!data.ok && data.error) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <div className="rounded border bg-white p-4">
          <div className="text-lg font-semibold">Link error</div>
          <div className="mt-2 text-sm text-neutral-600">{data.error}</div>
        </div>
      </div>
    );
  }

  const visibleSections = SECTIONS.filter((s) => s.track === "ALL" || s.track === track);

  return (
    <div className="mx-auto max-w-3xl p-6 space-y-4">
      <Header status={data.application?.status ?? "…"} busy={busy} onRefresh={() => load().then(recomputeEligibility).then(recomputeRequirements)} />

      <EligibilityCard elig={elig} />

      <BorrowerRequirementsCard result={reqs} />

      <BorrowerFormsCard result={forms} />

      <BorrowerPreflightCard result={preflight} />

      {preflight?.passed && (
        <div className="rounded border bg-white p-4 space-y-2">
          <div className="text-sm font-semibold">Final Steps</div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={generateNarrative}
              className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
            >
              Generate Narrative
            </button>
            <button
              onClick={generatePdf}
              className="rounded bg-purple-600 px-4 py-2 text-sm text-white hover:bg-purple-700"
            >
              Generate PDF
            </button>
            <button
              onClick={checkEtran}
              className="rounded bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700"
            >
              Check E-Tran
            </button>
            <button
              onClick={runAgentsCheck}
              className="rounded bg-cyan-600 px-4 py-2 text-sm text-white hover:bg-cyan-700"
            >
              Run Agents
            </button>
          </div>
          <button
            onClick={buildPackage}
            disabled={!narrative}
            className="w-full rounded bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700 disabled:opacity-50"
          >
            Build Complete SBA Package
          </button>
        </div>
      )}

      <BorrowerPackageCard result={pkg} />

      <BorrowerEtranCard result={etran} />

      <BorrowerAgentsCard result={agents} />

      {visibleSections.map((section) => (
        <div key={section.id} className="rounded border bg-white p-4 space-y-3">
          <div className="text-sm font-semibold">{section.title}</div>

          <div className="space-y-3">
            {section.questions.map((q) => (
              <Question
                key={q.key}
                q={q}
                value={answersObj[q.key]}
                onChange={(v) => saveAnswer(q.section, q.key, v)}
              />
            ))}
          </div>
        </div>
      ))}

      <div className="rounded border bg-white p-4">
        <button
          className="rounded bg-black px-4 py-2 text-sm text-white hover:opacity-90"
          onClick={submit}
        >
          Submit Application
        </button>
      </div>
    </div>
  );
}

function Header({ status, busy, onRefresh }: { status: string; busy: boolean; onRefresh: () => void }) {
  return (
    <div className="rounded border bg-white p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-lg font-semibold">Loan Application</div>
          <div className="text-xs text-neutral-500">Status: {status}</div>
        </div>
        <button
          className="rounded border px-3 py-1 text-sm hover:bg-neutral-50"
          onClick={onRefresh}
          disabled={busy}
        >
          Refresh
        </button>
      </div>
    </div>
  );
}

function EligibilityCard({ elig }: { elig: any }) {
  const r = elig?.result;
  if (!r) {
    return (
      <div className="rounded border bg-white p-4">
        <div className="text-sm font-semibold">SBA 7(a) Eligibility</div>
        <div className="mt-2 text-sm text-neutral-600">Calculating…</div>
      </div>
    );
  }

  const status = r.status as string;
  const badge =
    status === "ELIGIBLE" ? "✅ Eligible"
    : status === "INELIGIBLE" ? "⛔ Not eligible (based on current answers)"
    : "🟡 Need more info";

  return (
    <div className="rounded border bg-white p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">SBA 7(a) Eligibility</div>
        <div className="text-xs">{badge}</div>
      </div>

      <div className="text-xs text-neutral-600">
        Recommended track: <span className="font-semibold">{r.best_program}</span>
      </div>

      {Array.isArray(r.reasons) && r.reasons.length > 0 && (
        <div className="mt-2">
          <div className="text-xs font-semibold text-neutral-700">Reasons</div>
          <ul className="mt-1 list-disc pl-5 text-xs text-neutral-600 space-y-1">
            {r.reasons.map((x: any, i: number) => (
              <li key={i}>
                {x.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {Array.isArray(r.missing) && r.missing.length > 0 && (
        <div className="mt-2">
          <div className="text-xs font-semibold text-neutral-700">We still need</div>
          <ul className="mt-1 list-disc pl-5 text-xs text-neutral-600 space-y-1">
            {r.missing.slice(0, 6).map((x: any, i: number) => (
              <li key={i}>{x.question}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Question({
  q,
  value,
  onChange,
}: {
  q: any;
  value: any;
  onChange: (v: any) => void;
}) {
  const common = "w-full rounded border px-3 py-2 text-sm";

  if (q.type === "yesno") {
    const v = typeof value === "boolean" ? value : null;
    return (
      <div className="space-y-1">
        <div className="text-xs font-semibold text-neutral-600">{q.label}</div>
        <select
          className={common}
          value={v === null ? "" : v ? "yes" : "no"}
          onChange={(e) => {
            const s = e.target.value;
            if (s === "yes") onChange(true);
            else if (s === "no") onChange(false);
            else onChange(null);
          }}
        >
          <option value="">Select…</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </div>
    );
  }

  if (q.type === "select") {
    return (
      <div className="space-y-1">
        <div className="text-xs font-semibold text-neutral-600">{q.label}</div>
        <select className={common} value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select…</option>
          {(q.options ?? []).map((o: any) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
    );
  }

  if (q.type === "number") {
    return (
      <div className="space-y-1">
        <div className="text-xs font-semibold text-neutral-600">{q.label}</div>
        <input
          className={common}
          inputMode="decimal"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold text-neutral-600">{q.label}</div>
      <input className={common} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
