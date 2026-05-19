"use client";

import * as React from "react";
import { createClient } from "@supabase/supabase-js";
import { BorrowerChecklistSection } from "@/components/borrower/BorrowerChecklistSection";
import { BorrowerEmptyState } from "@/components/borrower/BorrowerEmptyState";
import { BorrowerHeroStatus } from "@/components/borrower/BorrowerHeroStatus";
import { BorrowerPrimaryActionCard } from "@/components/borrower/BorrowerPrimaryActionCard";
import { BorrowerProgressRail } from "@/components/borrower/BorrowerProgressRail";
import { BorrowerSafeError } from "@/components/borrower/BorrowerSafeError";
import { BorrowerShell } from "@/components/borrower/BorrowerShell";
import { BorrowerTrustFooter } from "@/components/borrower/BorrowerTrustFooter";
import { DocToolbar } from "@/components/borrower/DocToolbar";
import { TridentPreviewCard } from "@/components/borrower/TridentPreviewCard";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

type Deal = {
  id: string;
  name?: string | null;
  borrower_name?: string | null;
  borrower_email?: string | null;
  status?: string | null;
  stage?: string | null;
  city?: string | null;
  state?: string | null;
};

type Doc = {
  upload_id: string;
  filename: string;
  status: string;
  checklist_key?: string | null;
  doc_type?: string | null;
  confidence?: number | null;
};

type Field = {
  id: string;
  field_key: string;
  field_label: string;
  field_value: string;
  needs_attention: boolean;
  confirmed: boolean;
};

type PortalChecklistItem = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  group: string;
  required: boolean;
  status: "missing" | "received" | "verified" | string;
  completed_at: string | null;
};

type ChecklistStats = {
  required: number;
  missing: number;
  received: number;
};

type PortalStatus = {
  ok: boolean;
  progress?: number;
  checklist?: {
    total: number;
    received: number;
    missing: number;
    pct: number;
  };
  stage?: "waiting_for_checklist" | "uploading_docs" | "bank_review" | string;
  timeline?: Array<{
    id: string;
    title: string;
    subtitle: string;
    state: "done" | "current" | "upcoming";
  }>;
  eta?: {
    banker_review_by: string | null;
  };
};

const CHECKLIST_COPY: Record<
  string,
  {
    title: string;
    why: string;
    formats: string;
    examples: string;
    scans: string;
  }
> = {
  PERSONAL_FINANCIAL_STATEMENT: {
    title: "Personal Financial Statement",
    why: "Buddy uses this to complete the guarantor financial profile required in the SBA package.",
    formats: "PDF is best. A clean scan or completed bank form also works.",
    examples: "Completed SBA personal financial statement, signed bank PFS form, or a statement of assets and liabilities.",
    scans: "Yes. Clear scans and phone photos are acceptable if every number is readable.",
  },
  BUSINESS_TAX_RETURN: {
    title: "Business Tax Returns",
    why: "Buddy needs recent business tax returns to document revenue, cash flow, and operating history.",
    formats: "PDF is best. Multi-page scans are fine when every page is included.",
    examples: "Filed federal business tax return, complete 1120 or 1065 package, or accountant-prepared PDF copy.",
    scans: "Yes. Scans and phone photos are acceptable if each page is legible.",
  },
  VOIDED_CHECK: {
    title: "Voided Business Check",
    why: "Buddy uses this to confirm the business operating account details for SBA paperwork and funding setup.",
    formats: "PDF, PNG, or JPG all work.",
    examples: "Voided business checking account check or a bank-issued check image for the operating account.",
    scans: "Yes. A phone photo is acceptable if the account and routing details are clear.",
  },
};

function sanitizeBorrowerError(input: unknown) {
  const text = typeof input === "string" ? input.toLowerCase() : "";
  if (text.includes("invalid") || text.includes("expired") || text.includes("token")) {
    return "This private link is no longer active. Ask Buddy for a fresh portal link and try again.";
  }
  if (
    text.includes("storage") ||
    text.includes("bucket") ||
    text.includes("provider") ||
    text.includes("signed") ||
    text.includes("supabase")
  ) {
    return "We had trouble reaching your secure document portal. Please try again in a moment.";
  }
  return "We hit a temporary issue loading your SBA package. Please refresh and try again.";
}

function formatStageCopy(status: PortalStatus | null, deal: Deal | null) {
  const borrowerName = deal?.borrower_name?.trim();
  const displayName = borrowerName ? borrowerName.split(" ")[0] : "there";
  const required = status?.checklist?.total ?? 0;
  const received = status?.checklist?.received ?? 0;
  const missing = status?.checklist?.missing ?? 0;
  const eta = status?.eta?.banker_review_by
    ? new Date(status.eta.banker_review_by).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })
    : null;

  if (status?.stage === "bank_review") {
    return {
      tone: "review" as const,
      badge: "Buddy is reviewing your package",
      title: `Thanks, ${displayName}. Your SBA package is moving forward.`,
      summary: eta
        ? `Buddy has what it needs for the next review pass. We are organizing your documents now and expect the next review update by ${eta}.`
        : "Buddy has what it needs for the next review pass. We are organizing your documents now and will reach out if anything else is needed.",
      progressLabel: "Package review underway",
      checklistSummary:
        required > 0
          ? `${received} of ${required} requested items are already in your package.`
          : "Your package has been received and is moving into review.",
    };
  }

  if (required === 0 || status?.stage === "waiting_for_checklist") {
    return {
      tone: "progress" as const,
      badge: "Preparing your request list",
      title: `We're getting your SBA package ready, ${displayName}.`,
      summary:
        "Buddy is preparing the first document list for your package. You can still start the application and return as new requests appear.",
      progressLabel: "Checklist coming together",
      checklistSummary:
        "Your secure request list will appear here as soon as Buddy finishes setting it up.",
    };
  }

  return {
    tone: "progress" as const,
    badge: "Documents still needed",
    title: `Let's finish your SBA package, ${displayName}.`,
    summary:
      missing > 0
        ? `Buddy is waiting on ${missing} more requested document${missing === 1 ? "" : "s"}. Add the next item below and we'll keep your package moving.`
        : "You're making strong progress. Add any remaining files and Buddy will keep organizing the package for review.",
    progressLabel: "Package in progress",
    checklistSummary:
      `${received} of ${required} requested items are already in your package.`,
  };
}

function formatDocumentStatus(status: string) {
  const normalized = status.trim().toLowerCase();
  if (normalized === "submitted" || normalized === "confirmed") return "Received";
  if (normalized === "processing") return "Buddy is reviewing";
  if (normalized === "pending") return "Waiting for review";
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatChecklistStatus(status: string) {
  if (status === "verified") return "Reviewed";
  if (status === "received") return "Received";
  return "Needed";
}

function formatDateLabel(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatChecklistGroup(group: string) {
  if (!group) return "Requested documents";
  return group
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeChecklistKey(value?: string | null) {
  return String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function humanizeCode(code: string) {
  return code
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => {
      if (part === "irs") return "IRS";
      if (part === "sba") return "SBA";
      if (part === "pfs") return "PFS";
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

function borrowerChecklistCopy(item: PortalChecklistItem) {
  const normalizedCode = normalizeChecklistKey(item.code || item.title);
  const mapped = CHECKLIST_COPY[normalizedCode];
  const safeTitle =
    mapped?.title ??
    (item.title && !/[A-Z0-9_]{6,}/.test(item.title)
      ? item.title
      : humanizeCode(normalizedCode));

  return {
    title: safeTitle,
    why:
      mapped?.why ??
      "Buddy needs this document to complete the SBA package and reduce follow-up questions during review.",
    formats:
      mapped?.formats ??
      "PDF is best, and clear scans or common office document files also work.",
    examples:
      mapped?.examples ??
      `Typical examples include ${safeTitle.toLowerCase()}, accountant-prepared copies, or a clean exported PDF.`,
    scans:
      mapped?.scans ??
      "Yes. Clear scans and phone photos are acceptable if all text is easy to read.",
  };
}

function checklistItemStatusCopy(status: string, required: boolean) {
  if (status === "verified") {
    return { label: "Looks good", tone: "complete" as const };
  }
  if (status === "received") {
    return { label: "Buddy is reviewing this file", tone: "reviewing" as const };
  }
  return {
    label: required ? "Needs another file" : "Add when ready",
    tone: required ? ("required" as const) : ("optional" as const),
  };
}

function uploadStateCopy(status: string) {
  const normalized = status.trim().toLowerCase();
  if (normalized === "processing" || normalized === "received") {
    return "Buddy is reviewing this file";
  }
  if (normalized === "pending") return "Uploading...";
  if (normalized === "submitted" || normalized === "confirmed" || normalized === "complete") {
    return "Looks good";
  }
  return "Needs another file";
}

export function PortalClient({ token }: { token: string }) {
  const [deal, setDeal] = React.useState<Deal | null>(null);
  const [docs, setDocs] = React.useState<Doc[]>([]);
  const [activeUploadId, setActiveUploadId] = React.useState<string | null>(null);
  const [fields, setFields] = React.useState<Field[]>([]);
  const [checklist, setChecklist] = React.useState<PortalChecklistItem[]>([]);
  const [checklistStats, setChecklistStats] = React.useState<ChecklistStats | null>(null);
  const [portalStatus, setPortalStatus] = React.useState<PortalStatus | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [actionMessage, setActionMessage] = React.useState<string | null>(null);

  const activeDoc = React.useMemo(
    () => docs.find((doc) => doc.upload_id === activeUploadId) ?? null,
    [docs, activeUploadId],
  );

  const activeFields = React.useMemo(
    () => fields.filter((field) => field.needs_attention && !field.confirmed),
    [fields],
  );
  const confirmedCount = React.useMemo(
    () => fields.filter((field) => field.confirmed).length,
    [fields],
  );
  const missingChecklist = React.useMemo(
    () => checklist.filter((item) => item.required && (item.status ?? "missing") === "missing"),
    [checklist],
  );
  const groupedChecklist = React.useMemo(() => {
    const groups = new Map<string, PortalChecklistItem[]>();
    for (const item of checklist) {
      const key = formatChecklistGroup(item.group);
      const list = groups.get(key) ?? [];
      list.push(item);
      groups.set(key, list);
    }
    return Array.from(groups.entries());
  }, [checklist]);
  const completedChecklist = React.useMemo(
    () => checklist.filter((item) => item.required && (item.status ?? "missing") !== "missing"),
    [checklist],
  );

  const refreshDocs = React.useCallback(async () => {
    const { data, error } = await supabase.rpc("portal_list_uploads", { p_token: token });
    if (error) throw new Error(error.message);
    const nextDocs = (data as Doc[]) ?? [];
    setDocs(nextDocs);
    setActiveUploadId((current) => {
      if (current && nextDocs.some((doc) => doc.upload_id === current)) return current;
      return nextDocs[0]?.upload_id ?? null;
    });
  }, [token]);

  const refreshFields = React.useCallback(
    async (uploadId: string) => {
      const { data, error } = await supabase.rpc("portal_get_doc_fields", {
        p_token: token,
        p_upload_id: uploadId,
      });
      if (error) throw new Error(error.message);
      setFields((data as Field[]) ?? []);
    },
    [token],
  );

  const refreshChecklist = React.useCallback(async () => {
    const response = await fetch(`/api/portal/${token}/checklist`, { method: "GET" });
    const json = await response.json();
    if (!response.ok || !json?.ok) throw new Error(json?.error || `HTTP ${response.status}`);
    setChecklist((json.checklist ?? []) as PortalChecklistItem[]);
    setChecklistStats((json.stats ?? null) as ChecklistStats | null);
  }, [token]);

  const refreshStatus = React.useCallback(async () => {
    const response = await fetch(`/api/portal/${token}/status`, {
      method: "GET",
      cache: "no-store",
    });
    const json = (await response.json()) as PortalStatus;
    if (!response.ok || !json?.ok) throw new Error((json as any)?.error || `HTTP ${response.status}`);
    setPortalStatus(json);
  }, [token]);

  const loadPortal = React.useCallback(async () => {
    try {
      setLoading(true);
      setErr(null);
      const { data, error } = await supabase.rpc("portal_get_context", { p_token: token });
      if (error) throw new Error(error.message);
      setDeal((data as any).deal ?? null);
      await Promise.all([refreshDocs(), refreshChecklist(), refreshStatus()]);
    } catch (error) {
      setErr(sanitizeBorrowerError(error instanceof Error ? error.message : error));
    } finally {
      setLoading(false);
    }
  }, [refreshChecklist, refreshDocs, refreshStatus, token]);

  React.useEffect(() => {
    loadPortal();
  }, [loadPortal]);

  React.useEffect(() => {
    if (!activeUploadId) {
      setFields([]);
      return;
    }
    refreshFields(activeUploadId).catch((error) => {
      setActionMessage(sanitizeBorrowerError(error instanceof Error ? error.message : error));
    });
  }, [activeUploadId, refreshFields]);

  async function confirmField(fieldId: string) {
    if (!activeUploadId) return;
    setBusy(true);
    setActionMessage(null);
    try {
      const response = await fetch(`/api/portal/${token}/docs/${activeUploadId}/field-confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ field_id: fieldId }),
      });
      if (!response.ok) {
        const json = await response.json().catch(() => null);
        throw new Error(json?.error || "confirm_failed");
      }
      await refreshFields(activeUploadId);
    } catch (error) {
      setActionMessage(sanitizeBorrowerError(error instanceof Error ? error.message : error));
    } finally {
      setBusy(false);
    }
  }

  async function submitDoc() {
    if (!activeUploadId) return;
    setBusy(true);
    setActionMessage(null);
    try {
      const { error } = await supabase.rpc("portal_confirm_and_submit_document", {
        p_token: token,
        p_upload_id: activeUploadId,
      });
      if (error) throw new Error(error.message);
      setActionMessage("Buddy received that document and added it to your package.");
      await Promise.all([refreshDocs(), refreshChecklist(), refreshStatus(), refreshFields(activeUploadId)]);
    } catch (error) {
      setActionMessage(sanitizeBorrowerError(error instanceof Error ? error.message : error));
    } finally {
      setBusy(false);
    }
  }

  const stageCopy = formatStageCopy(portalStatus, deal);
  const progressValue = portalStatus?.progress ?? portalStatus?.checklist?.pct ?? 0;
  const timeline = portalStatus?.timeline ?? [];
  const primaryMissing = missingChecklist[0] ?? null;
  const primaryAction = primaryMissing
    ? {
        title: borrowerChecklistCopy(primaryMissing).title,
        description: "Add the next document Buddy requested so your SBA package can keep moving without delays.",
        detail: borrowerChecklistCopy(primaryMissing).why,
        ctaLabel: "Add requested document",
        hint: "You can upload from your phone or desktop. Clear scans and photos are okay.",
      }
    : docs.length === 0
      ? {
          title: "Start with your first requested file",
          description: "Once you add your first document, Buddy will organize it and update your package progress here.",
          detail: "PDF, spreadsheet, and document uploads still use the same secure flow as before.",
          ctaLabel: "Add your first document",
          hint: "Your secure link keeps this upload private.",
        }
      : {
          title: "Review the document Buddy is holding for you",
          description: "Select a file below, confirm any highlighted values, and submit it when everything looks right.",
          detail: "This keeps your package clean before it moves into review.",
          ctaLabel: activeDoc ? "Review selected document" : "Open your uploaded documents",
          hint: activeFields.length > 0 ? `${activeFields.length} highlighted value${activeFields.length === 1 ? "" : "s"} still need attention.` : "If nothing is highlighted, your document is ready to submit.",
        };

  if (loading) {
    return (
      <BorrowerShell
        hero={
          <div className="rounded-[1.75rem] border border-stone-200 bg-white p-6">
            <div className="h-4 w-28 rounded-full bg-stone-100" />
            <div className="mt-4 h-10 w-3/4 rounded-2xl bg-stone-100" />
            <div className="mt-3 h-4 w-full rounded-full bg-stone-100" />
            <div className="mt-2 h-4 w-2/3 rounded-full bg-stone-100" />
          </div>
        }
        primary={
          <div className="rounded-[1.5rem] border border-stone-200 bg-white p-6">
            <div className="h-5 w-48 rounded-full bg-stone-100" />
            <div className="mt-4 h-4 w-full rounded-full bg-stone-100" />
            <div className="mt-2 h-4 w-4/5 rounded-full bg-stone-100" />
            <div className="mt-5 h-12 w-56 rounded-2xl bg-stone-100" />
          </div>
        }
        rail={
          <div className="space-y-4">
            <div className="h-40 rounded-[1.5rem] border border-stone-200 bg-white" />
            <div className="h-72 rounded-[1.5rem] border border-stone-200 bg-white" />
          </div>
        }
        footer={<BorrowerTrustFooter />}
      >
        <div className="grid gap-6">
          <div className="h-64 rounded-[1.5rem] border border-stone-200 bg-white" />
          <div className="h-64 rounded-[1.5rem] border border-stone-200 bg-white" />
        </div>
      </BorrowerShell>
    );
  }

  if (err) {
    return (
      <BorrowerShell hero={<div />} footer={<BorrowerTrustFooter />}>
        <BorrowerSafeError
          title="We couldn't open this SBA portal"
          message={err}
          actionLabel="Try again"
          onAction={() => {
            void loadPortal();
          }}
        />
      </BorrowerShell>
    );
  }

  return (
    <BorrowerShell
      hero={
        <BorrowerHeroStatus
          eyebrow="Buddy SBA concierge"
          title={stageCopy.title}
          summary={stageCopy.summary}
          badge={stageCopy.badge}
          tone={stageCopy.tone}
          meta={[
            {
              label: "Business",
              value: deal?.name || "Your SBA request",
            },
            {
              label: "Documents received",
              value: checklistStats ? `${checklistStats.received} of ${checklistStats.required}` : "Updating now",
            },
            {
              label: "Current focus",
              value: primaryMissing ? "Add requested documents" : "Package review",
            },
          ]}
        />
      }
      primary={
        <BorrowerPrimaryActionCard
          title={primaryAction.title}
          description={primaryAction.description}
          detail={primaryAction.detail}
          ctaLabel={primaryAction.ctaLabel}
          hint={primaryAction.hint}
          onClick={() => {
            window.location.href = `/upload/${token}`;
          }}
        />
      }
      rail={
        <BorrowerProgressRail
          progressLabel={stageCopy.progressLabel}
          progressValue={progressValue}
          checklistSummary={stageCopy.checklistSummary}
          timeline={timeline}
        />
      }
      footer={<BorrowerTrustFooter />}
      mobileFooter={
        <button
          type="button"
          onClick={() => {
            window.location.href = `/upload/${token}`;
          }}
          className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-stone-950 px-5 py-3 text-sm font-semibold text-white"
        >
          <Icon name="cloud_upload" className="h-4 w-4 text-white" />
          {primaryMissing
            ? `Add ${borrowerChecklistCopy(primaryMissing).title}`
            : "Add requested document"}
        </button>
      }
    >
      <div className="space-y-6 pb-24 sm:pb-0">
        {actionMessage ? (
          actionMessage.includes("temporary issue") ||
          actionMessage.includes("no longer active") ? (
            <BorrowerSafeError
              title="We need a quick retry"
              message={actionMessage}
            />
          ) : (
            <div className="rounded-[1.5rem] border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-900">
              {actionMessage}
            </div>
          )
        ) : null}

        <section className="rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                Guided checklist
              </div>
              <h2 className="mt-2 text-xl font-semibold text-stone-950">
                Add the documents Buddy requested
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-600">
                {checklistStats
                  ? `${checklistStats.received} completed, ${checklistStats.missing} still needed. Work through one requirement at a time and Buddy will keep the package organized for you.`
                  : "Everything below is grouped so you can work through your SBA package one section at a time."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setActionMessage(null);
                void Promise.all([refreshChecklist(), refreshStatus()]).catch((error) => {
                  setActionMessage(
                    sanitizeBorrowerError(error instanceof Error ? error.message : error),
                  );
                });
              }}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-stone-900 focus:ring-offset-2"
            >
              <Icon name="refresh" className="h-4 w-4 text-current" />
              Refresh package status
            </button>
          </div>

          <div className="mt-5 space-y-4">
            {groupedChecklist.length === 0 ? (
              <BorrowerEmptyState
                title="Your request list is on the way"
                message="Buddy is preparing the first document group for this SBA package. You can start the application now and return when the checklist is ready."
              />
            ) : (
              <>
                {groupedChecklist.map(([group, items]) => {
                  const outstanding = items.filter(
                    (item) => item.required && (item.status ?? "missing") === "missing",
                  );

                  return (
                    <BorrowerChecklistSection
                      key={group}
                      title={group}
                      summary={`${outstanding.length} still needed in this section.`}
                      emptyTitle="This section is complete"
                      emptyMessage="Buddy already has every requested document in this section."
                      items={outstanding.map((item) => {
                        const helper = borrowerChecklistCopy(item);
                        const status = checklistItemStatusCopy(item.status ?? "missing", item.required);
                        return {
                          id: item.id,
                          title: helper.title,
                          description: item.description,
                          statusLabel: status.label,
                          statusTone: status.tone,
                          helper,
                          required: item.required,
                          completedLabel: null,
                        };
                      })}
                    />
                  );
                })}
                <BorrowerChecklistSection
                  title="Completed"
                  summary="These requested items are already in your package. Open this section if you want to review what Buddy has marked as complete."
                  emptyTitle="Nothing completed yet"
                  emptyMessage="Completed documents will move here automatically as Buddy receives and reviews them."
                  collapsible
                  items={completedChecklist.map((item) => {
                    const helper = borrowerChecklistCopy(item);
                    return {
                      id: item.id,
                      title: helper.title,
                      description: item.description,
                      statusLabel: "Looks good",
                      statusTone: "complete" as const,
                      helper,
                      required: item.required,
                      completedLabel: item.completed_at
                        ? `Completed ${formatDateLabel(item.completed_at)}`
                        : "Completed",
                    };
                  })}
                />
              </>
            )}
          </div>
        </section>

        <section className="rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                Your uploaded documents
              </div>
              <h2 className="mt-2 text-xl font-semibold text-stone-950">
                Review what Buddy already has
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-600">
                Choose a file to review, confirm anything Buddy flagged, and submit it into your package.
              </p>
            </div>
            <a
              href={`/upload/${token}`}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-stone-950 px-4 py-2 text-sm font-semibold text-white hover:bg-stone-800 focus:outline-none focus:ring-2 focus:ring-stone-900 focus:ring-offset-2"
            >
              <Icon name="cloud_upload" className="h-4 w-4 text-white" />
              Add more documents
            </a>
          </div>

          {docs.length === 0 ? (
            <div className="mt-5">
              <BorrowerEmptyState
                title="No documents uploaded yet"
                message="Once you add documents, Buddy will organize them here and guide you through any values that need confirmation."
                ctaLabel="Add documents"
                onClick={() => {
                  window.location.href = `/upload/${token}`;
                }}
              />
            </div>
          ) : (
            <div className="mt-5 grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
              <div className="space-y-3">
                {docs.map((doc) => (
                  <button
                    key={doc.upload_id}
                    type="button"
                    onClick={() => {
                      setActionMessage(null);
                      setActiveUploadId(doc.upload_id);
                    }}
                    className={cn(
                      "w-full rounded-[1.25rem] border px-4 py-4 text-left transition focus:outline-none focus:ring-2 focus:ring-stone-900 focus:ring-offset-2",
                      doc.upload_id === activeUploadId
                        ? "border-stone-900 bg-stone-950 text-white shadow-lg"
                        : "border-stone-200 bg-stone-50/70 text-stone-900 hover:bg-stone-100",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-base font-semibold">
                          {doc.filename}
                        </div>
                        <div
                          className={cn(
                            "mt-2 text-sm",
                            doc.upload_id === activeUploadId
                              ? "text-stone-300"
                              : "text-stone-600",
                          )}
                        >
                          {doc.doc_type
                            ? `Buddy filed this as ${humanizeCode(normalizeChecklistKey(doc.doc_type))}.`
                            : "Buddy will organize this file as soon as it finishes reviewing it."}
                        </div>
                      </div>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-3 py-1 text-xs font-semibold",
                          doc.upload_id === activeUploadId
                            ? "bg-white/15 text-white"
                            : "bg-white text-stone-700",
                        )}
                      >
                        {uploadStateCopy(doc.status)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>

              <div className="space-y-5">
                <div className="rounded-[1.25rem] border border-stone-200 bg-stone-50/70 p-4">
                  <DocToolbar
                    filename={activeDoc?.filename ?? "Select a document"}
                    pageLabel={
                      activeDoc?.doc_type
                        ? `Buddy labeled this as ${humanizeCode(normalizeChecklistKey(activeDoc.doc_type))}`
                        : "Secure document review"
                    }
                    onPrev={() => {}}
                    onNext={() => {}}
                    onRemove={() => {
                      setActionMessage("Document removal is not available from this portal.");
                    }}
                    onUploadNewVersion={() => {
                      window.location.href = `/upload/${token}`;
                    }}
                  />
                  <div className="mt-4 rounded-[1rem] border border-dashed border-stone-300 bg-white p-8 text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-stone-100">
                      <Icon name="description" className="h-5 w-5 text-stone-700" />
                    </div>
                    <div className="mt-4 text-base font-semibold text-stone-900">
                      Document review stays inside this secure portal
                    </div>
                    <p className="mt-2 text-sm leading-6 text-stone-600">
                      Buddy will keep your uploaded file tied to this package while you confirm any highlighted values below.
                    </p>
                  </div>
                </div>

                <div className="rounded-[1.25rem] border border-stone-200 bg-white p-5">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-stone-950">
                        Buddy's highlighted details
                      </h3>
                      <p className="mt-1 text-sm text-stone-600">
                        Confirm anything flagged before you submit this document.
                      </p>
                    </div>
                    <div className="rounded-full bg-stone-100 px-3 py-1 text-sm font-semibold text-stone-700">
                      {confirmedCount} of {fields.length} confirmed
                    </div>
                  </div>

                  {fields.length === 0 ? (
                    <div className="mt-5">
                      <BorrowerEmptyState
                        title="No highlighted values yet"
                        message="Buddy has not flagged any values on this document. If it looks right, you can still submit it into your package."
                      />
                    </div>
                  ) : (
                    <div className="mt-5 space-y-3">
                      {fields.map((field) => {
                        const needsAttention = field.needs_attention && !field.confirmed;
                        return (
                          <div
                            key={field.id}
                            className={cn(
                              "rounded-[1rem] border px-4 py-4",
                              needsAttention
                                ? "border-amber-200 bg-amber-50/80"
                                : "border-stone-200 bg-stone-50/60",
                            )}
                          >
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-semibold uppercase tracking-[0.16em] text-stone-500">
                                  {field.field_label}
                                </div>
                                <input
                                  value={field.field_value}
                                  readOnly
                                  aria-label={field.field_label}
                                  className={cn(
                                    "mt-2 min-h-12 w-full rounded-2xl border px-4 py-3 text-sm text-stone-900 focus:outline-none",
                                    needsAttention
                                      ? "border-amber-300 bg-white"
                                      : "border-stone-200 bg-white",
                                  )}
                                />
                                {needsAttention ? (
                                  <p className="mt-2 text-sm text-amber-900">
                                    Please check that this value matches your document.
                                  </p>
                                ) : null}
                              </div>
                              <div className="shrink-0">
                                {field.confirmed ? (
                                  <span className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-2 text-sm font-semibold text-emerald-900">
                                    <Icon name="check_circle" className="h-4 w-4 text-current" />
                                    Confirmed
                                  </span>
                                ) : needsAttention ? (
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => {
                                      void confirmField(field.id);
                                    }}
                                    className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-stone-950 px-4 py-2 text-sm font-semibold text-white hover:bg-stone-800 focus:outline-none focus:ring-2 focus:ring-stone-900 focus:ring-offset-2 disabled:opacity-60"
                                  >
                                    Confirm this value
                                  </button>
                                ) : (
                                  <span className="text-sm text-stone-500">
                                    No action needed
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                    <button
                      type="button"
                      disabled={busy || !activeUploadId || activeFields.length > 0}
                      onClick={() => {
                        void submitDoc();
                      }}
                      className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-stone-950 px-4 py-3 text-sm font-semibold text-white hover:bg-stone-800 focus:outline-none focus:ring-2 focus:ring-stone-900 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-stone-300 disabled:text-stone-600"
                    >
                      <Icon name="check_circle" className="h-5 w-5 text-current" />
                      Submit this document to Buddy
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActionMessage(null);
                        void refreshDocs().catch((error) => {
                          setActionMessage(
                            sanitizeBorrowerError(error instanceof Error ? error.message : error),
                          );
                        });
                      }}
                      className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-stone-300 px-4 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-stone-900 focus:ring-offset-2"
                    >
                      Refresh documents
                    </button>
                  </div>
                  <p className="mt-3 text-sm text-stone-600">
                    If Buddy still needs a clearer copy, upload another file and we will review it again without changing your checklist flow.
                  </p>
                </div>
              </div>
            </div>
          )}
        </section>

        <TridentPreviewCard token={token} />
      </div>
    </BorrowerShell>
  );
}
