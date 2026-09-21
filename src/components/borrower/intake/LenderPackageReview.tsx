"use client";
import { useCallback, useEffect, useState } from "react";
import {
  LENDER_PACKAGE_FILES,
  BORROWER_PACKAGE_FILES,
} from "@/lib/brokerage/lenderPackageFiles";
import { PACKAGE_PREPARATION_LABELS, type PackagePreparationStatus } from "@/lib/brokerage/borrowerPackagePreparationState";

type Value = string | number | null | Value[] | { [key: string]: Value };
const groups = {
  revenueStreams: "Revenue",
  costAssumptions: "Costs and staffing",
  workingCapital: "Working capital",
  loanImpact: "Loan and funding",
  managementTeam: "Management",
};
const additions: Record<string, Value> = {
  revenueStreams: {
    id: "",
    name: "",
    baseAnnualRevenue: null,
    growthRateYear1: null,
    growthRateYear2: null,
    growthRateYear3: null,
    pricingModel: "flat",
    seasonalityProfile: null,
  },
  fixedCostCategories: { name: "", annualAmount: 0, escalationPctPerYear: 0 },
  plannedHires: { role: "", startMonth: 1, annualSalary: 0 },
  plannedCapex: { description: "", amount: 0, year: 1 },
  existingDebt: {
    description: "",
    currentBalance: 0,
    monthlyPayment: 0,
    remainingTermMonths: 0,
    treatment: "retain",
  },
  otherSources: { description: "", amount: 0 },
  managementTeam: {
    name: "",
    title: "",
    ownershipPct: 0,
    yearsInIndustry: 0,
    bio: "",
  },
};
const choices: Record<string, string[]> = {
  pricingModel: ["flat", "per_unit", "subscription", "pct_revenue"],
  treatment: ["retain", "refinance", "payoff"],
  equityInjectionSource: ["cash_savings", "401k_rollover", "gift", "other"],
};
const friendlyLabels: Record<string, string> = {
  targetDSO: "Days until customers pay",
  targetDPO: "Days until you pay suppliers",
  inventoryTurns: "Inventory turns per year",
  cogsPercentYear1: "Direct costs as a share of sales — year 1",
  cogsPercentYear2: "Direct costs as a share of sales — year 2",
  cogsPercentYear3: "Direct costs as a share of sales — year 3",
  termMonths: "Proposed loan term in months",
  interestRate: "Assumed annual interest rate",
  equityInjectionAmount: "Your contribution",
  baseAnnualRevenue: "Starting annual revenue",
  bio: "Relevant experience",
};
const label = (key: string) =>
  friendlyLabels[key] ??
  key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replace(/^./, (x) => x.toUpperCase());
const fieldClass =
  "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";
function Field({
  name,
  value,
  change,
}: {
  name: string;
  value: Value;
  change: (value: Value) => void;
}) {
  if (name === "id") return null;
  if (name === "seasonalityProfile" && value === null)
    return (
      <button
        type="button"
        className="text-sm text-sky-700 underline"
        onClick={() => change(Array(12).fill(1))}
      >
        Add monthly seasonality (currently even throughout the year)
      </button>
    );
  if (Array.isArray(value))
    return (
      <fieldset className="space-y-3">
        <legend className="font-medium">{label(name)}</legend>
        {value.map((item, i) => (
          <div key={i} className="rounded-lg border p-3">
            <Field
              name={`${name === "seasonalityProfile" ? "Month" : "Item"} ${i + 1}`}
              value={item}
              change={(next) =>
                change(value.map((v, j) => (j === i ? next : v)))
              }
            />
            {name !== "seasonalityProfile" && (
              <button
                type="button"
                className="mt-2 text-xs underline"
                onClick={() => change(value.filter((_, j) => i !== j))}
              >
                Remove item
              </button>
            )}
          </div>
        ))}
        {additions[name] && (
          <button
            type="button"
            className="rounded-lg border px-3 py-2 text-sm"
            onClick={() => {
              const item = structuredClone(additions[name]);
              if (
                item &&
                typeof item === "object" &&
                !Array.isArray(item) &&
                "id" in item
              )
                item.id = crypto.randomUUID();
              change([...value, item]);
            }}
          >
            Add item
          </button>
        )}
      </fieldset>
    );
  if (value && typeof value === "object")
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {Object.entries(value).map(([key, val]) => (
          <div
            key={key}
            className={
              typeof val === "object" && val !== null ? "sm:col-span-2" : ""
            }
          >
            <Field
              name={key}
              value={val}
              change={(next) => change({ ...value, [key]: next })}
            />
          </div>
        ))}
      </div>
    );
  const percent =
    /growthRate|cogsPercent|escalationPct|interestRate|sellerFinancingRate|revenueImpactPct/.test(
      name,
    );
  // Keep an emptied number field numeric so typing a replacement remains valid.
  const numeric =
    typeof value === "number" ||
    percent ||
    /(?:Amount|Revenue|Salary|Balance|Payment|Months|Month|DSO|DPO|Turns|InIndustry|Pct)$/.test(
      name,
    ) ||
    ["amount", "year"].includes(name) ||
    /^Month \d+$/.test(name);
  return (
    <label className="block text-sm text-slate-700">
      {label(name)}
      {percent ? " (%)" : ""}
      {choices[name] ? (
        <select
          className={fieldClass}
          value={String(value ?? "")}
          onChange={(e) => change(e.target.value)}
        >
          {choices[name].map((v) => (
            <option key={v} value={v}>
              {label(v)}
            </option>
          ))}
        </select>
      ) : numeric ? (
        <input
          className={fieldClass}
          type="number"
          step="any"
          value={
            value == null
              ? ""
              : percent
                ? Number((Number(value) * 100).toFixed(8))
                : String(value)
          }
          onChange={(e) =>
            change(
              e.target.value === ""
                ? null
                : Number(e.target.value) / (percent ? 100 : 1),
            )
          }
        />
      ) : (
        <textarea
          className={fieldClass}
          rows={name === "bio" ? 3 : 2}
          value={String(value ?? "")}
          onChange={(e) => change(e.target.value)}
        />
      )}
    </label>
  );
}

export function LenderPackageReview({
  dealId,
  onDirtyChange,
  onQuestion,
  snapshotRevision,
  posterAcknowledged,
}: {
  dealId: string;
  onDirtyChange: (dirty: boolean) => void;
  onQuestion?: (id: string) => void;
  snapshotRevision?: string | null;
  posterAcknowledged?: boolean;
}) {
  const [assumptions, setAssumptions] = useState<Record<string, Value> | null>(
    null,
  );
  const [revision, setRevision] = useState<string | null>(null);
  const [status, setStatus] = useState("draft");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [bundle, setBundle] = useState<Record<string, any> | null>(null);
  const [preparation, setPreparation] = useState<PackagePreparationStatus | null>(null);
  const [released, setReleased] = useState(false);
  const [readiness, setReadiness] = useState<{
    readyToGenerate: boolean;
    readyToPrepare: boolean;
    blockers: string[];
    completionItems?: Array<{ id: string; label: string; questionId?: string }>;
    warnings: string[];
    packageFiles: Array<{ key: string; label: string; ready: boolean }>;
  } | null>(null);
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const base = `/api/brokerage/deals/${encodeURIComponent(dealId)}/borrower-actions/`;
  const call = useCallback(
    async (action: string, body?: object) => {
      const response = await fetch(base + action, {
        cache: "no-store",
        ...(body
          ? {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            }
          : {}),
      });
      const result = await response.json();
      if (!response.ok || !result.ok)
        throw new Error(
          [result.error ?? "Please retry.", ...(result.blockers ?? [])].join(
            "\n",
          ),
        );
      return result;
    },
    [base],
  );
  const refresh = useCallback(async () => {
    const r = await call("package-status");
    setBundle(r.bundle);
    setReleased(r.release?.released === true);
    setPreparation(r.preparation ?? null);
    setReadiness(r.readiness ?? null);
  }, [call]);
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, [refresh, snapshotRevision, posterAcknowledged]);
  useEffect(() => {
    let cancelled = false;
    void call("assumptions")
      .then((a) => {
        if (cancelled) return;
        setAssumptions(a.assumptions);
        setRevision(a.revision);
        setStatus(a.status);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [call]);
  const running = preparation?.status === "running" || (bundle && ["pending", "running"].includes(bundle.status));
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible")
        void refresh().catch((e) => setError(e.message));
    }, 15000);
    return () => clearInterval(timer);
  }, [running, refresh]);
  async function discardDraft() {
    setBusy("reload");
    setError("");
    try {
      const saved = await call("assumptions");
      setAssumptions(saved.assumptions);
      setRevision(saved.revision);
      setStatus(saved.status);
      setDirty(false);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not reload your saved assumptions.",
      );
    } finally {
      setBusy("");
    }
  }
  async function perform(action: string) {
    setBusy(action);
    setError("");
    try {
      const data = await call(
        action === "confirm" || action === "save" ? "assumptions" : action,
        action === "confirm" || action === "save"
          ? { assumptions, revision, confirmed: action === "confirm" }
          : {},
      );
      if (data.assumptions) {
        setAssumptions(data.assumptions);
        setRevision(data.revision);
        setStatus(data.status);
        setDirty(action === "draft-assumptions");
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please retry.");
    } finally {
      setBusy("");
    }
  }
  const ready =
    !running &&
    preparation?.status !== "failed" &&
    !dirty &&
    status === "confirmed" &&
    (!revision ||
      Date.parse(bundle?.generation_completed_at ?? "") >=
        Date.parse(revision)) &&
    bundle?.status === "succeeded" &&
    LENDER_PACKAGE_FILES.every((file) => bundle[file.column]);
  return (
    <section className="rounded-2xl border bg-white p-5 text-slate-900">
      <h3 className="text-lg font-semibold">
        Review and prepare your lender package
      </h3>
      <p className="mt-2 text-sm text-slate-600">
        Buddy uses your saved answers and financial documents to draft the
        assumptions. Review the numbers below, confirm them, then prepare your
        package. Dollar amounts are USD.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={!!busy || !!running || dirty}
          className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50"
          onClick={() => void perform("draft-assumptions")}
        >
          {busy === "draft-assumptions"
            ? "Buddy is preparing your assumptions…"
            : "Draft assumptions from my answers"}
        </button>
        {status === "confirmed" && !dirty && (
          <span className="self-center text-sm text-emerald-700">
            Assumptions confirmed
          </span>
        )}
      </div>
      {!assumptions && (
        <button
          type="button"
          disabled={!!busy || !!running}
          className="mt-4 min-h-11 text-sm font-semibold text-sky-800 underline"
          onClick={() => {
            setAssumptions({
              revenueStreams: [],
              costAssumptions: {
                cogsPercentYear1: null,
                cogsPercentYear2: null,
                cogsPercentYear3: null,
                fixedCostCategories: [],
                plannedHires: [],
                plannedCapex: [],
              },
              workingCapital: {
                targetDSO: null,
                targetDPO: null,
                inventoryTurns: null,
              },
              loanImpact: {
                loanAmount: null,
                termMonths: null,
                interestRate: null,
                existingDebt: [],
                equityInjectionAmount: null,
                equityInjectionSource: "other",
                sellerFinancingAmount: null,
                sellerFinancingTermMonths: null,
                sellerFinancingRate: null,
                otherSources: [],
              },
              managementTeam: [],
            });
            setDirty(true);
          }}
        >
          Enter assumptions myself — no AI needed
        </button>
      )}
      <p className="mt-3 text-xs leading-5 text-slate-600">
        Drafting with Buddy and preparing a package use AI services. Entering
        and saving your own assumptions does not. Review every figure; proposed
        loan terms are assumptions until a lender provides an offer.
      </p>
      {assumptions && (
        <fieldset disabled={!!busy || !!running} className="mt-4 space-y-3">
          {Object.entries(groups).map(([key, title]) => (
            <details key={key} className="rounded-xl border p-4">
              <summary className="cursor-pointer font-medium">{title}</summary>
              <div className="mt-4">
                <Field
                  name={key}
                  value={assumptions[key] ?? []}
                  change={(value) => {
                    setAssumptions({ ...assumptions, [key]: value });
                    setDirty(true);
                  }}
                />
              </div>
            </details>
          ))}
          <div className="flex flex-wrap gap-3">
            {dirty && (
              <button
                type="button"
                className="rounded-lg border px-4 py-2 text-sm"
                onClick={() => void discardDraft()}
              >
                Discard unsaved changes
              </button>
            )}
            <button
              type="button"
              className="rounded-lg border px-4 py-2 text-sm"
              onClick={() => void perform("save")}
            >
              Save draft
            </button>
            <button
              type="button"
              className="rounded-lg bg-sky-700 px-4 py-2 text-sm text-white"
              onClick={() => void perform("confirm")}
            >
              Confirm these assumptions
            </button>
          </div>
        </fieldset>
      )}
      <div className="mt-6 border-t pt-4">
        {readiness && !running && (
          <section
            className={`mb-5 rounded-xl border p-4 ${readiness.readyToPrepare && preparation?.status !== "failed" && bundle?.status !== "failed" ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}
          >
            <h4 className="font-semibold">
              {preparation?.status === "failed" || bundle?.status === "failed"
                ? "Package preparation needs attention"
                : readiness.readyToPrepare
                ? "Your information is ready for package preparation"
                : "Here’s what Buddy still needs"}
            </h4>
            {readiness.blockers.length > 0 && (
              <ul className="mt-3 space-y-2 text-sm text-slate-700">
                {readiness.blockers.map((blocker) => (
                  <li key={blocker} className="flex gap-2">
                    <span aria-hidden="true">○</span>
                    <span>{blocker}{readiness.completionItems?.find(item => item.label === blocker)?.questionId && onQuestion && (
                      <button type="button" className="ml-2 underline text-sky-700" disabled={dirty || !!busy}
                        onClick={() => onQuestion(readiness.completionItems!.find(item => item.label === blocker)!.questionId!)}>Answer this question</button>
                    )}</span>
                  </li>
                ))}
              </ul>
            )}
            {readiness.warnings.length > 0 && (
              <ul className="mt-3 text-sm text-slate-600">
                {readiness.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
          </section>
        )}
        <button
          type="button"
          disabled={
            !!busy ||
            !!running ||
            dirty ||
            status !== "confirmed" ||
            readiness?.readyToPrepare !== true
          }
          className="rounded-lg bg-sky-700 px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
          onClick={() => void perform("build-package")}
        >
          {running
            ? "Buddy is preparing your package…"
            : busy === "build-package"
              ? "Checking your application…"
              : preparation?.status === "failed" || bundle?.status === "failed"
                ? "Retry package preparation"
                : "Prepare lender package"}
        </button>
        <button
          type="button"
          className="ml-3 text-sm underline"
          onClick={() => void refresh().catch((e) => setError(e.message))}
        >
          Refresh status
        </button>
        {running && (
          <div role="status" aria-live="polite" className="mt-3 rounded-lg bg-sky-50 p-3 text-sm text-slate-700">
            <p className="font-medium">{PACKAGE_PREPARATION_LABELS[preparation?.status === "running" ? preparation.stage : "generation"]}</p>
            <p className="mt-1">Buddy checks your information, prepares business research, then creates your documents. This can take several minutes. You can leave this page and return to check progress.</p>
          </div>
        )}
        {preparation?.status === "failed" && !running && (
          <p role="alert" className="mt-3 whitespace-pre-wrap rounded-lg bg-amber-50 p-3 text-sm">
            {preparation.message || "Preparation could not be completed. Please retry."}
          </p>
        )}
        {bundle?.status === "failed" && preparation?.status !== "failed" && !running && (
          <p
            role="alert"
            className="mt-3 whitespace-pre-wrap rounded-lg bg-amber-50 p-3 text-sm"
          >
            {bundle.generation_error ||
              "The package could not be completed. Review your inputs and retry."}
          </p>
        )}
        <ul
          aria-label="Package document status"
          className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200 px-4"
        >
          {(readiness?.packageFiles?.filter(
            (file) => file.key !== "credit_memo_pdf_path",
          ) ??
            BORROWER_PACKAGE_FILES.map((file) => ({
              key: file.kind,
              label: file.label,
              ready,
            }))).map((file) => (
            <li
              key={file.key}
              className="flex items-center justify-between gap-3 py-3 text-sm"
            >
              <span>{file.label}</span>
              <span
                className={
                  file.ready ? "text-emerald-800" : "text-slate-500"
                }
              >
                {file.ready
                  ? "Prepared"
                  : running
                    ? "Preparing"
                    : "Not ready yet"}
              </span>
            </li>
          ))}
        </ul>
        {ready && !released && (
          <p role="status" className="mt-4 rounded-xl bg-sky-50 p-4 text-sm text-sky-900">
            Your documents are prepared for lender review. Your business plan, feasibility study,
            projections and spreads unlock after a bank claims your deal and you select that bank.
            You can continue reviewing your information and completing required forms and signatures.
          </p>
        )}
        {ready && released && (
          <div className="mt-4">
            <a
              className="inline-block rounded-lg bg-emerald-700 px-4 py-3 text-sm text-white"
              href={`/api/brokerage/deals/${dealId}/trident/download/complete_package`}
            >
              Download your application documents
            </a>
            <p className="mt-2 text-sm text-slate-600">
              Includes the business plan, projections with assumptions,
              feasibility study, spreads and applicable SBA forms. The internal
              credit memo is reserved for authorized lenders. Prepared for
              lender review; signatures and closing requirements remain subject
              to lender confirmation.
            </p>
          </div>
        )}
      </div>
      {error && (
        <p
          role="alert"
          className="mt-3 whitespace-pre-wrap rounded-lg bg-amber-50 p-3 text-sm"
        >
          {error}
        </p>
      )}
    </section>
  );
}
