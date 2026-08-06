"use client";

/**
 * Welcome Back application chooser — shown after email verification when
 * one or more prior applications exist for the verified email. Never
 * auto-resumes anything; every action here is an explicit borrower choice.
 *
 * Mirrors BorrowerWorkspaceGate.tsx's visual language and internal
 * step-state pattern (a small local Step union, same as that component's
 * "identify" | "code" | "settling").
 */

import * as React from "react";
import { Icon } from "@/components/ui/Icon";

type ApplicationBucket = "active" | "completed" | "previous" | "unknown";

type Application = {
  id: string;
  businessName: string | null;
  loanPurpose: string | null;
  status: string | null;
  statusLabel: string;
  lastActivityAt: string | null;
  bucket: ApplicationBucket;
};

type Step = "choice" | "confirmNew";

function formatDate(iso: string | null): string {
  if (!iso) return "No recent activity";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function ApplicationCard({
  app,
  onAction,
  busy,
}: {
  app: Application;
  onAction: (app: Application) => void;
  busy: boolean;
}) {
  const actionLabel =
    app.bucket === "completed" ? "View Completed Package" : app.bucket === "active" ? "Continue Application" : null;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="truncate font-heading text-base font-bold text-slate-900">
            {app.businessName ?? "Your SBA request"}
          </p>
          <p className="text-sm text-slate-600">{app.loanPurpose ?? "Loan purpose not yet provided"}</p>
          <p className="text-xs text-slate-500">
            {app.statusLabel} · Last activity {formatDate(app.lastActivityAt)}
          </p>
        </div>
        {actionLabel ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onAction(app)}
            className={
              app.bucket === "active"
                ? "brand-gradient-cta shrink-0 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
                : "shrink-0 rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
            }
          >
            {actionLabel}
          </button>
        ) : (
          <span className="shrink-0 text-xs text-slate-400">Contact support to continue this application</span>
        )}
      </div>
    </div>
  );
}

export function ApplicationChooserScreen({
  onResolved,
}: {
  onResolved: (dealId: string) => void;
}) {
  const [applications, setApplications] = React.useState<Application[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [step, setStep] = React.useState<Step>("choice");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    fetch("/api/brokerage/session/applications", { credentials: "include" })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok || !data.ok) {
          setError("We couldn't load your applications. Please try again.");
          return;
        }
        setApplications(data.applications ?? []);
      })
      .catch(() => setError("Connection lost while loading your applications."))
      .finally(() => setLoading(false));
  }, []);

  const submitChoice = async (body: { action: "resume" | "view" | "new"; dealId?: string }) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/brokerage/session/applications", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError("Buddy couldn't complete that. Please try again.");
        setBusy(false);
        return;
      }
      onResolved(data.dealId as string);
    } catch {
      setError("Buddy couldn't reach the server. Check your connection and try again.");
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
        <p className="text-sm text-slate-500">Loading your applications…</p>
      </div>
    );
  }

  if (step === "confirmNew") {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
        <div className="mb-5 flex items-center gap-3">
          <div className="brand-gradient-cta flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
            <Icon name="auto_awesome" className="h-5 w-5 text-white" />
          </div>
          <h2 className="font-heading text-lg font-bold text-slate-900">Start a New SBA Package?</h2>
        </div>
        <p className="text-sm leading-6 text-slate-600">
          Your existing application will remain available. Your new package will be completely separate and will
          not copy documents, ownership information, financial information, questionnaire answers, or readiness
          progress.
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            disabled={busy}
            onClick={() => setStep("choice")}
            className="flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
          >
            Back to My Applications
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void submitChoice({ action: "new" })}
            className="brand-gradient-cta flex-1 rounded-xl px-4 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
          >
            {busy ? "Creating…" : "Create New Package"}
          </button>
        </div>
      </div>
    );
  }

  const active = (applications ?? []).filter((a) => a.bucket === "active");
  const completed = (applications ?? []).filter((a) => a.bucket === "completed");
  const other = (applications ?? []).filter((a) => a.bucket === "previous" || a.bucket === "unknown");

  const handleCardAction = (app: Application) => {
    if (app.bucket === "active") void submitChoice({ action: "resume", dealId: app.id });
    else if (app.bucket === "completed") void submitChoice({ action: "view", dealId: app.id });
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
      <div className="mb-6">
        <h2 className="font-heading text-xl font-bold text-slate-900">Welcome back</h2>
        <p className="mt-1 text-sm text-slate-600">
          We found an existing SBA package associated with your verified email.
        </p>
      </div>

      {error && (
        <p role="alert" className="mb-4 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="space-y-6">
        {active.length > 0 && (
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Active Applications
            </h3>
            <div className="space-y-3">
              {active.map((app) => (
                <ApplicationCard key={app.id} app={app} onAction={handleCardAction} busy={busy} />
              ))}
            </div>
          </section>
        )}

        {completed.length > 0 && (
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Completed Applications
            </h3>
            <div className="space-y-3">
              {completed.map((app) => (
                <ApplicationCard key={app.id} app={app} onAction={handleCardAction} busy={busy} />
              ))}
            </div>
          </section>
        )}

        {other.length > 0 && (
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Other Applications
            </h3>
            <div className="space-y-3">
              {other.map((app) => (
                <ApplicationCard key={app.id} app={app} onAction={handleCardAction} busy={busy} />
              ))}
            </div>
          </section>
        )}
      </div>

      <div className="mt-6 border-t border-slate-100 pt-6">
        <p className="text-sm font-medium text-slate-800">Need financing for something different?</p>
        <p className="text-sm text-slate-600">Start a completely new SBA package.</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => setStep("confirmNew")}
          className="mt-3 rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
        >
          Start New Package
        </button>
      </div>
    </div>
  );
}
