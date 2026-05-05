"use client";

import { useState } from "react";
import { useStageJsonResource } from "../_shared/useStageJsonResource";
import { useInlineMutation } from "../../actions/useInlineMutation";

/**
 * SPEC-06 — inline override editor for the Decision stage.
 *
 * Owns a /overrides fetch via useStageJsonResource (scope: "overrides").
 * Inline actions: add override, edit rationale, mark reviewed.
 * Each mutation runs through useInlineMutation with optimistic updates +
 * scoped refresh.
 *
 * Note: full overrides today require decision_snapshot_id, field_path, and
 * old/new values — that depth lives on the dedicated /decision/overrides
 * surface. The cockpit version surfaces add/edit/review for the rationale
 * trail; field-path-level edits stay on the dedicated route.
 */
export type OverrideRow = {
  id: string;
  field_path?: string;
  old_value?: unknown;
  new_value?: unknown;
  reason?: string | null;
  justification?: string | null;
  severity?: string | null;
  requires_review?: boolean;
  created_at?: string | null;
};

type OverridesApi = {
  ok?: boolean;
  overrides?: OverrideRow[];
};

const SEVERITY_OPTIONS = ["LOW", "MEDIUM", "HIGH"] as const;

export function OverrideInlineEditor({ dealId }: { dealId: string }) {
  const overrides = useStageJsonResource<OverridesApi>(
    `/api/deals/${dealId}/overrides`,
    { id: "decision:overrides-editor", scope: "overrides" },
  );
  const mutation = useInlineMutation(dealId);

  const [draftFieldPath, setDraftFieldPath] = useState("");
  const [draftReason, setDraftReason] = useState("");
  const [draftSeverity, setDraftSeverity] =
    useState<(typeof SEVERITY_OPTIONS)[number]>("LOW");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingReason, setEditingReason] = useState("");

  const items = overrides.data?.overrides ?? [];

  const updateLocal = (
    updater: (rows: OverrideRow[]) => OverrideRow[],
  ): { previous: OverridesApi | null } => {
    const previous = overrides.data;
    overrides.setOptimisticData((current) => {
      const list = current?.overrides ?? [];
      return { ...(current ?? {}), overrides: updater(list) };
    });
    return { previous };
  };

  async function handleAdd() {
    const field_path = draftFieldPath.trim();
    const reason = draftReason.trim();
    if (!field_path || !reason) return;

    const tempId = `optimistic:${Date.now()}`;
    const optimisticRow: OverrideRow = {
      id: tempId,
      field_path,
      reason,
      severity: draftSeverity,
      requires_review: true,
      old_value: null,
      new_value: null,
      created_at: new Date().toISOString(),
    };
    const { previous } = updateLocal((rows) => [optimisticRow, ...rows]);

    const ok = await mutation.run({
      id: tempId,
      kind: "add",
      domain: "overrides",
      optimistic: () => {},
      revert: () => overrides.setOptimisticData(() => previous),
      request: () =>
        fetch(`/api/deals/${dealId}/overrides`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            field_path,
            reason,
            severity: draftSeverity,
            requires_review: true,
            // Provide neutral defaults; full edits happen on /decision/overrides.
            old_value: null,
            new_value: null,
          }),
        }),
    });
    if (ok) {
      setDraftFieldPath("");
      setDraftReason("");
      setDraftSeverity("LOW");
    }
  }

  async function handleSaveReason(row: OverrideRow) {
    const reason = editingReason.trim();
    const prevReason = row.reason ?? null;
    const previous = overrides.data;
    updateLocal((rows) =>
      rows.map((r) => (r.id === row.id ? { ...r, reason } : r)),
    );
    setEditingId(null);
    await mutation.run({
      id: row.id,
      kind: "update",
      domain: "overrides",
      optimistic: () => {},
      revert: () => overrides.setOptimisticData(() => previous),
      request: () =>
        fetch(`/api/deals/${dealId}/overrides/${row.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason }),
        }),
      // SPEC-07: merge canonical override row from PATCH response.
      reconcile: (serverJson: { override?: OverrideRow }) => {
        if (!serverJson?.override) return false;
        overrides.setOptimisticData((current) => {
          const list = current?.overrides ?? [];
          return {
            ...(current ?? {}),
            overrides: list.map((r) =>
              r.id === row.id ? { ...r, ...serverJson.override! } : r,
            ),
          };
        });
        return true;
      },
      undo: {
        label: "Undo rationale edit",
        optimistic: () =>
          overrides.setOptimisticData((current) => {
            const list = current?.overrides ?? [];
            return {
              ...(current ?? {}),
              overrides: list.map((r) =>
                r.id === row.id ? { ...r, reason: prevReason } : r,
              ),
            };
          }),
        revert: () => overrides.setOptimisticData(() => previous),
        request: () =>
          fetch(`/api/deals/${dealId}/overrides/${row.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ reason: prevReason ?? "" }),
          }),
      },
    });
  }

  async function handleMarkReviewed(row: OverrideRow) {
    const previous = overrides.data;
    const prevRequiresReview = row.requires_review ?? true;
    updateLocal((rows) =>
      rows.map((r) => (r.id === row.id ? { ...r, requires_review: false } : r)),
    );
    await mutation.run({
      id: row.id,
      kind: "review",
      domain: "overrides",
      optimistic: () => {},
      revert: () => overrides.setOptimisticData(() => previous),
      request: () =>
        fetch(`/api/deals/${dealId}/overrides/${row.id}/review`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        }),
      reconcile: (serverJson: { override?: OverrideRow }) => {
        if (!serverJson?.override) return false;
        overrides.setOptimisticData((current) => {
          const list = current?.overrides ?? [];
          return {
            ...(current ?? {}),
            overrides: list.map((r) =>
              r.id === row.id ? { ...r, ...serverJson.override! } : r,
            ),
          };
        });
        return true;
      },
      // SPEC-07: undo flips requires_review back via PATCH (allowed for
      // this field since SPEC-07 widens the allow-list).
      undo: {
        label: "Undo mark reviewed",
        optimistic: () =>
          overrides.setOptimisticData((current) => {
            const list = current?.overrides ?? [];
            return {
              ...(current ?? {}),
              overrides: list.map((r) =>
                r.id === row.id
                  ? { ...r, requires_review: prevRequiresReview }
                  : r,
              ),
            };
          }),
        revert: () => overrides.setOptimisticData(() => previous),
        request: () =>
          fetch(`/api/deals/${dealId}/overrides/${row.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ requires_review: prevRequiresReview }),
          }),
      },
    });
  }

  return (
    <section
      data-testid="override-inline-editor"
      className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5"
    >
      <header className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-amber-300 text-[20px]">
            edit_note
          </span>
          <h3 className="text-sm font-semibold text-white">Override Audit</h3>
        </div>
        <span className="text-[10px] uppercase tracking-wide text-white/40">
          {items.length} total
        </span>
      </header>

      <form
        className="mb-4 grid grid-cols-1 gap-2 rounded-lg border border-white/10 bg-black/20 p-3 sm:grid-cols-12"
        data-testid="override-add-form"
        onSubmit={(e) => {
          e.preventDefault();
          void handleAdd();
        }}
      >
        <input
          value={draftFieldPath}
          onChange={(e) => setDraftFieldPath(e.target.value)}
          placeholder="Field path (e.g. dscr.threshold)"
          className="rounded-md border border-white/10 bg-black/40 px-3 py-1.5 text-xs text-white placeholder-white/30 sm:col-span-4"
          data-testid="override-add-field-path"
        />
        <input
          value={draftReason}
          onChange={(e) => setDraftReason(e.target.value)}
          placeholder="Rationale"
          className="rounded-md border border-white/10 bg-black/40 px-3 py-1.5 text-xs text-white placeholder-white/30 sm:col-span-5"
          data-testid="override-add-reason"
        />
        <select
          value={draftSeverity}
          onChange={(e) =>
            setDraftSeverity(e.target.value as (typeof SEVERITY_OPTIONS)[number])
          }
          className="rounded-md border border-white/10 bg-black/40 px-3 py-1.5 text-xs text-white sm:col-span-2"
        >
          {SEVERITY_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={
            !draftFieldPath.trim() ||
            !draftReason.trim() ||
            mutation.state.status === "pending"
          }
          className="rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-xs font-semibold text-blue-100 hover:bg-blue-500/20 disabled:opacity-60 sm:col-span-1"
          data-testid="override-add-submit"
        >
          Add
        </button>
      </form>

      {overrides.error ? (
        <div className="mb-3 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-[11px] text-rose-200">
          {overrides.error}
        </div>
      ) : null}

      {mutation.state.lastUndo ? (
        <div
          className="mb-3 inline-flex items-center gap-2 rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-[11px] text-blue-100"
          data-testid="override-undo-banner"
          role="status"
        >
          <span>{mutation.state.lastUndo.label}</span>
          <button
            type="button"
            onClick={() => void mutation.runUndo()}
            className="rounded border border-blue-300/30 bg-blue-500/20 px-2 py-0.5 text-[11px] font-semibold text-blue-50 hover:bg-blue-500/30"
            data-testid="override-undo-button"
          >
            Undo
          </button>
        </div>
      ) : null}

      {items.length === 0 && !overrides.loading ? (
        <p className="text-xs text-white/40">No overrides recorded.</p>
      ) : null}

      <ul className="space-y-2">
        {items.map((row) => {
          const isEditing = editingId === row.id;
          const isPending =
            mutation.state.status === "pending" &&
            mutation.state.activeId === row.id;
          const isFailed =
            mutation.state.status === "error" &&
            mutation.state.activeId === row.id;
          return (
            <li
              key={row.id}
              className="rounded-lg border border-white/10 bg-black/20 p-3"
              data-override-id={row.id}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold uppercase text-white/70">
                      {row.severity ?? "—"}
                    </span>
                    <span className="text-sm text-white">
                      {row.field_path ?? "(field unknown)"}
                    </span>
                    {row.requires_review ? (
                      <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-200">
                        REVIEW
                      </span>
                    ) : (
                      <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-200">
                        REVIEWED
                      </span>
                    )}
                  </div>
                  {!isEditing && row.reason ? (
                    <div className="mt-1 text-xs text-white/60">
                      {row.reason}
                    </div>
                  ) : null}
                  {isEditing ? (
                    <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center">
                      <input
                        value={editingReason}
                        onChange={(e) => setEditingReason(e.target.value)}
                        className="flex-1 rounded-md border border-white/10 bg-black/40 px-3 py-1.5 text-xs text-white"
                        data-testid="override-edit-input"
                      />
                      <button
                        type="button"
                        className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/20"
                        onClick={() => void handleSaveReason(row)}
                        data-testid="override-edit-save"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10"
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : null}
                  {isFailed && mutation.state.errorMessage ? (
                    <div
                      className="mt-1 inline-flex items-center gap-1 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[11px] text-rose-200"
                      role="alert"
                    >
                      {mutation.state.errorMessage}
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {!isEditing ? (
                    <button
                      type="button"
                      className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-semibold text-white/80 hover:bg-white/10 disabled:opacity-60"
                      onClick={() => {
                        setEditingId(row.id);
                        setEditingReason(row.reason ?? "");
                      }}
                      disabled={isPending}
                      data-testid="override-edit-toggle"
                    >
                      Edit rationale
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold text-emerald-100 hover:bg-emerald-500/20 disabled:opacity-60"
                    onClick={() => void handleMarkReviewed(row)}
                    disabled={isPending || row.requires_review === false}
                    data-testid="override-mark-reviewed"
                  >
                    Mark reviewed
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
