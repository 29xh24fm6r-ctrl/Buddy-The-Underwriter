"use client";

import * as React from "react";

type DealStage =
  | "intake"
  | "docs_in_progress"
  | "analysis"
  | "underwriting"
  | "conditional_approval"
  | "closing"
  | "funded"
  | "declined";

const STAGES: Array<{ value: DealStage; label: string }> = [
  { value: "intake", label: "Intake" },
  { value: "docs_in_progress", label: "Docs in progress" },
  { value: "analysis", label: "Analysis" },
  { value: "underwriting", label: "Underwriting" },
  { value: "conditional_approval", label: "Conditional approval" },
  { value: "closing", label: "Closing" },
  { value: "funded", label: "Funded" },
  { value: "declined", label: "Declined" },
];

type EtaTemplate = {
  id: string;
  label: string;
  note: string;
  created_at: string;
  created_by: string | null;
};

export function DealStageEtaControls(props: {
  dealId: string;
  initialStage?: DealStage;
  initialEtaDate?: string | null; // YYYY-MM-DD
  initialEtaNote?: string | null;
  // Provide this from your app session (Clerk userId, etc.)
  actorUserId: string;
  onSaved?: (next: { stage: DealStage; etaDate: string | null; etaNote: string | null }) => void;
}) {
  const [stage, setStage] = React.useState<DealStage>(props.initialStage ?? "intake");
  const [etaDate, setEtaDate] = React.useState<string>(props.initialEtaDate ?? "");
  const [etaNote, setEtaNote] = React.useState<string>(props.initialEtaNote ?? "");

  const [templates, setTemplates] = React.useState<EtaTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = React.useState<string>("");

  const [saving, setSaving] = React.useState(false);
  const [loadingTemplates, setLoadingTemplates] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [okFlash, setOkFlash] = React.useState(false);

  const [showCreate, setShowCreate] = React.useState(false);
  const [newLabel, setNewLabel] = React.useState("");
  const [newNote, setNewNote] = React.useState("");

  async function loadTemplates() {
    setLoadingTemplates(true);
    try {
      const res = await fetch("/api/banker/eta-templates", {
        method: "GET",
        headers: { "x-user-id": props.actorUserId },
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? "Failed to load templates");
      setTemplates(json.templates ?? []);
    } catch (e: any) {
      // soft-fail; templates are a bonus
      console.warn("Template load failed:", e?.message ?? e);
    } finally {
      setLoadingTemplates(false);
    }
  }

  React.useEffect(() => {
    loadTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyTemplate() {
    const t = templates.find((x) => x.id === selectedTemplateId);
    if (!t) return;
    setEtaNote(t.note);
  }

  async function createTemplate() {
    setError(null);
    try {
      const label = newLabel.trim();
      const note = newNote.trim();
      if (!label) throw new Error("Template label required.");
      if (!note) throw new Error("Template note required.");

      const res = await fetch("/api/banker/eta-templates", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-id": props.actorUserId,
        },
        body: JSON.stringify({ label, note }),
      });

      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? "Failed to create template");

      setNewLabel("");
      setNewNote("");
      setShowCreate(false);

      // refresh list + auto-select new template
      await loadTemplates();
      const created: EtaTemplate | undefined = json.template;
      if (created?.id) {
        setSelectedTemplateId(created.id);
        setEtaNote(created.note);
      }
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    setOkFlash(false);

    try {
      const res = await fetch(`/api/deals/${props.dealId}/status`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-user-id": props.actorUserId,
        },
        body: JSON.stringify({
          stage,
          etaDate: etaDate ? etaDate : null,
          etaNote: etaNote ? etaNote : null,
        }),
      });

      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? "Save failed");

      setOkFlash(true);
      props.onSaved?.({ stage, etaDate: etaDate ? etaDate : null, etaNote: etaNote ? etaNote : null });
      window.setTimeout(() => setOkFlash(false), 1200);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Row 1: Stage / ETA / Save */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="h-9 rounded-md border px-2 text-sm"
          value={stage}
          onChange={(e) => setStage(e.target.value as DealStage)}
          disabled={saving}
          aria-label="Deal stage"
        >
          {STAGES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>

        <input
          className="h-9 rounded-md border px-2 text-sm"
          type="date"
          value={etaDate}
          onChange={(e) => setEtaDate(e.target.value)}
          disabled={saving}
          aria-label="ETA date"
        />

        <button
          className="h-9 rounded-md border px-3 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          onClick={save}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save"}
        </button>

        {okFlash ? <span className="text-sm text-green-700">Saved</span> : null}
      </div>

      {/* Row 2: Templates */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="h-9 min-w-[220px] rounded-md border px-2 text-sm"
          value={selectedTemplateId}
          onChange={(e) => setSelectedTemplateId(e.target.value)}
          disabled={saving || loadingTemplates}
          aria-label="ETA note templates"
        >
          <option value="">{loadingTemplates ? "Loading templates…" : "Apply a template…"}</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>

        <button
          className="h-9 rounded-md border px-3 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          onClick={applyTemplate}
          disabled={!selectedTemplateId || saving}
        >
          Apply
        </button>

        <button
          className="h-9 rounded-md border px-3 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          onClick={() => setShowCreate((v) => !v)}
          disabled={saving}
        >
          {showCreate ? "Close" : "New template"}
        </button>
      </div>

      {/* Row 3: Note editor */}
      <input
        className="h-9 w-full rounded-md border px-2 text-sm"
        placeholder='Borrower-safe note (e.g. "Waiting on appraisal scheduling")'
        value={etaNote}
        onChange={(e) => setEtaNote(e.target.value)}
        disabled={saving}
        aria-label="Borrower-safe ETA note"
      />

      {/* Create template mini form */}
      {showCreate ? (
        <div className="rounded-lg border bg-white p-3">
          <div className="grid gap-2 md:grid-cols-3">
            <input
              className="h-9 rounded-md border px-2 text-sm"
              placeholder="Template label (e.g. Ordered appraisal)"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              disabled={saving}
            />
            <input
              className="md:col-span-2 h-9 rounded-md border px-2 text-sm"
              placeholder="Template note (borrower-safe)"
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              disabled={saving}
            />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button
              className="h-9 rounded-md border px-3 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
              onClick={createTemplate}
              disabled={saving}
            >
              Save template
            </button>
            <span className="text-xs text-gray-500">Tip: templates are shared + reusable.</span>
          </div>
        </div>
      ) : null}

      {error ? <div className="text-sm text-red-700">{error}</div> : null}
    </div>
  );
}
