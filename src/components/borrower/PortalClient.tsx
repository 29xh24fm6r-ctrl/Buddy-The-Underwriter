"use client";

import * as React from "react";
import { PortalShell } from "@/components/borrower/PortalShell";
import { DocToolbar } from "@/components/borrower/DocToolbar";
import { Icon } from "@/components/ui/Icon";
import { createClient } from "@supabase/supabase-js";

// Borrower uses anon client + RPCs (SECURITY DEFINER pattern)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
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

export function PortalClient({ token }: { token: string }) {
  const [deal, setDeal] = React.useState<Deal | null>(null);
  const [docs, setDocs] = React.useState<Doc[]>([]);
  const [activeUploadId, setActiveUploadId] = React.useState<string | null>(null);
  const [fields, setFields] = React.useState<Field[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const activeDoc = React.useMemo(() => docs.find((d) => d.upload_id === activeUploadId) ?? null, [docs, activeUploadId]);
  const active = activeDoc;

  const needsAttention = fields.filter((f) => f.needs_attention && !f.confirmed).length;
  const confirmed = fields.filter((f) => f.confirmed).length;

  const refreshDocs = React.useCallback(async () => {
    const { data, error } = await supabase.rpc("portal_list_uploads", {
      p_token: token,
    });
    if (error) throw new Error(error.message);
    setDocs(data as Doc[]);
    if (!activeUploadId && data && data[0]?.upload_id) {
      setActiveUploadId(data[0].upload_id);
    }
  }, [token, activeUploadId]);

  const refreshFields = React.useCallback(async (uploadId: string) => {
    const { data, error } = await supabase.rpc("portal_get_doc_fields", {
      p_token: token,
      p_upload_id: uploadId,
    });
    if (error) throw new Error(error.message);
    setFields(data as Field[]);
  }, [token]);

  React.useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setErr(null);
        const { data, error } = await supabase.rpc("portal_get_context", {
          p_token: token,
        });
        if (error) throw new Error(error.message);
        setDeal((data as any).deal);
        await refreshDocs();
      } catch (e: any) {
        setErr(e?.message ?? "Failed to load portal");
      } finally {
        setLoading(false);
      }
    })();
  }, [token, refreshDocs]);

  React.useEffect(() => {
    if (!activeUploadId) return;
    refreshFields(activeUploadId).catch((e: any) => setErr(e?.message ?? "Failed to load fields"));
  }, [activeUploadId, refreshFields]);

  async function confirmField(fieldId: string) {
    if (!activeUploadId) return;
    setBusy(true);
    try {
      // Call legacy API for field confirm (can convert to RPC later if needed)
      const res = await fetch(`/api/portal/${token}/docs/${activeUploadId}/field-confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ field_id: fieldId }),
      });
      if (!res.ok) throw new Error("Failed to confirm field");
      await refreshFields(activeUploadId);
    } finally {
      setBusy(false);
    }
  }

  async function submitDoc() {
    if (!activeUploadId) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc("portal_confirm_and_submit_document", {
        p_token: token,
        p_upload_id: activeUploadId,
      });
      if (error) throw new Error(error.message);
      await refreshDocs();
      await refreshFields(activeUploadId);
    } catch (e: any) {
      alert(e?.message ?? "Submit failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-dvh bg-neutral-950 text-neutral-100 flex items-center justify-center">
        <div className="rounded-xl bg-white text-neutral-900 px-6 py-4 shadow-lg">Loading portal…</div>
      </div>
    );
  }

  if (err) {
    return (
      <div className="min-h-dvh bg-neutral-950 text-neutral-100 flex items-center justify-center">
        <div className="max-w-lg rounded-2xl bg-white text-neutral-900 p-6 shadow-lg">
          <div className="text-lg font-semibold">Portal error</div>
          <div className="mt-2 text-sm text-neutral-700">{err}</div>
        </div>
      </div>
    );
  }

  return (
    <PortalShell
      title="Buddy Portal"
      subtitle={deal?.name ? `Deal: ${deal.name}` : "Review extracted data and confirm your documents."}
      left={
        <div className="space-y-4">
          <div className="rounded-xl border border-neutral-200 p-4">
            <button
              type="button"
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-neutral-900 px-3 py-2 text-sm text-white hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-900"
              onClick={() => alert("Upload flow: use /upload/[token] (wired separately)")}
            >
              <Icon name="cloud_upload" className="h-4 w-4 text-white" />
              Upload New Document
            </button>
            <p className="mt-2 text-xs text-neutral-500">PDF, Excel, Word (Max 50MB)</p>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Your Documents
            </div>
            <ul className="space-y-2">
              {docs.map((d) => (
                <li key={d.upload_id}>
                  <button
                    type="button"
                    onClick={() => setActiveUploadId(d.upload_id)}
                    className={[
                      "w-full rounded-xl border p-3 text-left transition focus:outline-none focus:ring-2 focus:ring-neutral-900",
                      d.upload_id === activeUploadId ? "border-neutral-900 bg-neutral-50" : "border-neutral-200 hover:bg-neutral-50",
                    ].join(" ")}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 truncate text-sm font-medium">{d.filename}</div>
                      <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-1 text-[11px] font-medium text-neutral-700">
                        {d.status}
                      </span>
                    </div>
                    {d.checklist_key ? <div className="mt-1 text-xs text-neutral-500">Checklist: {d.checklist_key}</div> : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      }
      center={
        <div className="space-y-4">
          <DocToolbar
            filename={active?.filename ?? "No document selected"}
            pageLabel={active?.doc_type ? `Type: ${active.doc_type}` : undefined}
            onPrev={() => {}}
            onNext={() => {}}
            onRemove={() => alert("Remove: implement if desired")}
            onUploadNewVersion={() => alert("Upload new version: implement signed upload + replace")}
          />

          <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
            <div className="h-[420px] rounded-lg bg-white shadow-inner">
              <div className="flex h-full items-center justify-center text-sm text-neutral-500">
                PDF Preview: wire your viewer to Storage signed URL
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-neutral-200 p-4">
            <div className="flex items-center gap-2">
              <Icon name="auto_awesome" className="h-5 w-5" />
              <div className="text-sm font-semibold">What We Read</div>
              <div className="ml-auto text-xs text-neutral-500">Confirm highlighted values</div>
            </div>

            <div className="mt-4 divide-y divide-neutral-200">
              {fields.map((f) => (
                <div key={f.id} className="flex items-center gap-3 py-3">
                  <div className="w-48 shrink-0 text-sm text-neutral-600">{f.field_label}</div>
                  <div className="min-w-0 flex-1">
                    <input
                      className={[
                        "w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900",
                        f.needs_attention && !f.confirmed ? "border-amber-400 bg-amber-50" : "border-neutral-200 bg-white",
                      ].join(" ")}
                      value={f.field_value}
                      readOnly
                      aria-label={f.field_label}
                    />
                    {f.needs_attention && !f.confirmed ? (
                      <div className="mt-1 text-xs text-amber-800">Please verify this value matches the document.</div>
                    ) : null}
                  </div>
                  <div className="shrink-0">
                    {f.confirmed ? (
                      <span className="inline-flex items-center gap-1 text-sm text-emerald-700">
                        <Icon name="check_circle" className="h-4 w-4" />
                        Confirmed
                      </span>
                    ) : f.needs_attention ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => confirmField(f.id)}
                        className="rounded-lg bg-neutral-900 px-3 py-2 text-sm text-white hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-900 disabled:opacity-60"
                      >
                        Confirm
                      </button>
                    ) : (
                      <span className="text-sm text-neutral-500">—</span>
                    )}
                  </div>
                </div>
              ))}
              {fields.length === 0 ? <div className="py-6 text-sm text-neutral-500">No extracted fields yet.</div> : null}
            </div>
          </div>
        </div>
      }
      right={
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">Review & Confirm</div>
              <div className="mt-1 text-xs text-neutral-500">Confirm highlighted fields before submitting.</div>
            </div>
            <button type="button" className="rounded-lg border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-neutral-900" onClick={() => alert("Save & Exit")}>
              Save & Exit
            </button>
          </div>

          <div className="rounded-xl border border-neutral-200 p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Confirmation Progress</div>
              <div className="text-sm text-neutral-700">{confirmed} of {fields.length} fields</div>
            </div>
            <div className="mt-3 h-2 w-full rounded-full bg-neutral-100">
              <div className="h-2 rounded-full bg-neutral-900" style={{ width: `${fields.length ? Math.round((confirmed / fields.length) * 100) : 0}%` }} />
            </div>

            {needsAttention > 0 ? (
              <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                <div className="font-semibold">Fields needing attention</div>
                <div className="mt-1 text-xs">{needsAttention} remaining</div>
              </div>
            ) : (
              <div className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
                <div className="font-semibold">Ready to submit</div>
                <div className="mt-1 text-xs">All highlighted fields confirmed.</div>
              </div>
            )}
          </div>

          <button
            type="button"
            disabled={busy || !activeUploadId || needsAttention > 0}
            onClick={submitDoc}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-neutral-900 px-4 py-3 text-sm font-semibold text-white hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-900 disabled:opacity-60"
          >
            <Icon name="check_circle" className="h-5 w-5 text-white" />
            Confirm & Submit Document
          </button>

          <button
            type="button"
            onClick={() => refreshDocs()}
            className="w-full rounded-xl border border-neutral-300 px-4 py-3 text-sm hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-neutral-900"
          >
            Refresh
          </button>
        </div>
      }
    />
  );
}
