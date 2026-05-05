"use client";

import { useState } from "react";
import { useStageJsonResource } from "../_shared/useStageJsonResource";
import { useInlineMutation } from "../../actions/useInlineMutation";
import type {
  DealConditionRow,
  DealConditionsApi,
} from "@/lib/journey/contracts/conditions";

/**
 * SPEC-06 — inline condition editor for Decision and Closing stages.
 *
 * Owns its own /conditions/list fetch via useStageJsonResource (scope:
 * "conditions"), so any inline mutation triggers a scoped refresh of
 * the same resource — without re-fetching the rest of the stage.
 *
 * Inline actions: add condition, mark satisfied, mark waived, edit note.
 * Each mutation runs through useInlineMutation: optimistic update →
 * POST/PATCH → scoped refresh → telemetry.
 *
 * SPEC-09: migrated to the canonical DealConditionRow contract from
 * src/lib/journey/contracts/conditions.ts. The local `ConditionRow`
 * alias is preserved as a re-export for backward compatibility but the
 * underlying type is identical.
 */
export type ConditionRow = DealConditionRow;

type ConditionsListApi = DealConditionsApi;

const STATUS_TONE: Record<string, string> = {
  satisfied: "bg-emerald-500/15 text-emerald-200 border-emerald-500/30",
  waived: "bg-blue-500/15 text-blue-200 border-blue-500/30",
  rejected: "bg-rose-500/15 text-rose-200 border-rose-500/30",
  open: "bg-amber-500/15 text-amber-200 border-amber-500/30",
};

export function ConditionsInlineEditor({
  dealId,
  surface,
}: {
  dealId: string;
  /** Used in the section title; "decision" or "closing". */
  surface?: "decision" | "closing";
}) {
  const conditions = useStageJsonResource<ConditionsListApi>(
    `/api/deals/${dealId}/conditions/list`,
    { id: `${surface ?? "stage"}:conditions-editor`, scope: "conditions" },
  );
  const mutation = useInlineMutation(dealId);

  const [draftTitle, setDraftTitle] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDescription, setEditingDescription] = useState("");

  // SPEC-07: prefer canonical `conditions`; fall back to legacy `items`
  // alias during the deprecation window.
  const items = conditions.data?.conditions ?? conditions.data?.items ?? [];

  const updateLocal = (
    updater: (rows: ConditionRow[]) => ConditionRow[],
  ): { previous: ConditionsListApi | null } => {
    const previous = conditions.data;
    conditions.setOptimisticData((current) => {
      const list = current?.conditions ?? current?.items ?? [];
      const next = updater(list);
      return { ...(current ?? {}), conditions: next, items: next };
    });
    return { previous };
  };

  async function handleAdd() {
    const title = draftTitle.trim();
    if (!title) return;
    const tempId = `optimistic:${Date.now()}`;
    const optimisticRow: ConditionRow = {
      id: tempId,
      deal_id: dealId,
      title,
      description: draftDescription.trim() || null,
      status: "open",
      category: null,
      due_date: null,
    };
    const { previous } = updateLocal((rows) => [optimisticRow, ...rows]);

    const ok = await mutation.run({
      id: tempId,
      kind: "add",
      domain: "conditions",
      optimistic: () => {},
      revert: () => conditions.setOptimisticData(() => previous),
      request: () =>
        fetch(`/api/deals/${dealId}/conditions/add`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title, description: optimisticRow.description }),
        }),
    });

    if (ok) {
      setDraftTitle("");
      setDraftDescription("");
    }
  }

  async function handleStatus(row: ConditionRow, status: "satisfied" | "waived" | "open") {
    const previous = conditions.data;
    const prevStatus = (row.status ?? "open") as
      | "open"
      | "satisfied"
      | "waived"
      | "rejected";
    updateLocal((rows) =>
      rows.map((r) => (r.id === row.id ? { ...r, status } : r)),
    );
    await mutation.run({
      id: row.id,
      kind: "status",
      domain: "conditions",
      optimistic: () => {},
      revert: () => conditions.setOptimisticData(() => previous),
      request: () =>
        fetch(`/api/deals/${dealId}/conditions/set-status`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ condition_id: row.id, status }),
        }),
      // SPEC-08: reconcile from canonical condition row when set-status
      // returns one. Skips the immediate hard refresh.
      reconcile: (serverJson: { condition?: ConditionRow }) => {
        if (!serverJson?.condition) return false;
        conditions.setOptimisticData((current) => {
          const list = current?.conditions ?? current?.items ?? [];
          const next = list.map((r) =>
            r.id === row.id ? { ...r, ...serverJson.condition! } : r,
          );
          return { ...(current ?? {}), conditions: next, items: next };
        });
        return true;
      },
      // SPEC-07: undo restores the previous status.
      undo: {
        label: `Undo "${status}"`,
        optimistic: () =>
          conditions.setOptimisticData((current) => {
            const list =
              current?.conditions ?? current?.items ?? [];
            const next = list.map((r) =>
              r.id === row.id ? { ...r, status: prevStatus } : r,
            );
            return { ...(current ?? {}), conditions: next, items: next };
          }),
        revert: () => conditions.setOptimisticData(() => previous),
        request: () =>
          fetch(`/api/deals/${dealId}/conditions/set-status`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              condition_id: row.id,
              status: prevStatus,
            }),
          }),
      },
    });
  }

  async function handleSaveNote(row: ConditionRow) {
    const description = editingDescription.trim();
    const prevDescription = row.description ?? null;
    const previous = conditions.data;
    updateLocal((rows) =>
      rows.map((r) => (r.id === row.id ? { ...r, description } : r)),
    );
    setEditingId(null);
    await mutation.run({
      id: row.id,
      kind: "update",
      domain: "conditions",
      optimistic: () => {},
      revert: () => conditions.setOptimisticData(() => previous),
      request: () =>
        fetch(`/api/deals/${dealId}/conditions/${row.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ description }),
        }),
      // SPEC-07: reconcile canonical condition row from PATCH response so we
      // skip the hard refresh and avoid the visible flicker.
      reconcile: (serverJson: { condition?: ConditionRow }) => {
        if (!serverJson?.condition) return false;
        conditions.setOptimisticData((current) => {
          const list = current?.conditions ?? current?.items ?? [];
          const next = list.map((r) =>
            r.id === row.id ? { ...r, ...serverJson.condition! } : r,
          );
          return { ...(current ?? {}), conditions: next, items: next };
        });
        return true;
      },
      // SPEC-07: undo restores the previous note.
      undo: {
        label: "Undo note edit",
        optimistic: () =>
          conditions.setOptimisticData((current) => {
            const list = current?.conditions ?? current?.items ?? [];
            const next = list.map((r) =>
              r.id === row.id ? { ...r, description: prevDescription } : r,
            );
            return { ...(current ?? {}), conditions: next, items: next };
          }),
        revert: () => conditions.setOptimisticData(() => previous),
        request: () =>
          fetch(`/api/deals/${dealId}/conditions/${row.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ description: prevDescription ?? "" }),
          }),
      },
    });
  }

  return (
    <section
      data-testid="conditions-inline-editor"
      data-surface={surface ?? "stage"}
      className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5"
    >
      <header className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-blue-300 text-[20px]">
            playlist_add_check
          </span>
          <h3 className="text-sm font-semibold text-white">Conditions</h3>
        </div>
        <span className="text-[10px] uppercase tracking-wide text-white/40">
          {items.length} total
        </span>
      </header>

      {/* Add form */}
      <form
        className="mb-4 flex flex-col gap-2 rounded-lg border border-white/10 bg-black/20 p-3 sm:flex-row sm:items-center"
        data-testid="conditions-add-form"
        onSubmit={(e) => {
          e.preventDefault();
          void handleAdd();
        }}
      >
        <input
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          placeholder="New condition title"
          className="flex-1 rounded-md border border-white/10 bg-black/40 px-3 py-1.5 text-xs text-white placeholder-white/30"
          data-testid="conditions-add-title"
        />
        <input
          value={draftDescription}
          onChange={(e) => setDraftDescription(e.target.value)}
          placeholder="Optional note"
          className="flex-1 rounded-md border border-white/10 bg-black/40 px-3 py-1.5 text-xs text-white placeholder-white/30"
        />
        <button
          type="submit"
          disabled={!draftTitle.trim() || mutation.state.status === "pending"}
          className="rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-xs font-semibold text-blue-100 hover:bg-blue-500/20 disabled:opacity-60"
          data-testid="conditions-add-submit"
        >
          Add
        </button>
      </form>

      {conditions.error ? (
        <div className="mb-3 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-[11px] text-rose-200">
          {conditions.error}
        </div>
      ) : null}

      {mutation.state.lastUndo ? (
        <div
          className="mb-3 inline-flex items-center gap-2 rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-[11px] text-blue-100"
          data-testid="conditions-undo-banner"
          role="status"
        >
          <span>{mutation.state.lastUndo.label}</span>
          <button
            type="button"
            onClick={() => void mutation.runUndo()}
            className="rounded border border-blue-300/30 bg-blue-500/20 px-2 py-0.5 text-[11px] font-semibold text-blue-50 hover:bg-blue-500/30"
            data-testid="conditions-undo-button"
          >
            Undo
          </button>
        </div>
      ) : null}

      {items.length === 0 && !conditions.loading ? (
        <p className="text-xs text-white/40">No conditions yet.</p>
      ) : null}

      <ul className="space-y-2">
        {items.map((row) => {
          const status = (row.status ?? "open").toLowerCase();
          const tone = STATUS_TONE[status] ?? STATUS_TONE.open;
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
              data-condition-id={row.id}
              data-condition-status={status}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${tone}`}
                    >
                      {status}
                    </span>
                    <span className="truncate text-sm text-white">
                      {row.title}
                    </span>
                  </div>
                  {!isEditing && row.description ? (
                    <div className="mt-1 text-xs text-white/60">
                      {row.description}
                    </div>
                  ) : null}
                  {isEditing ? (
                    <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center">
                      <input
                        value={editingDescription}
                        onChange={(e) =>
                          setEditingDescription(e.target.value)
                        }
                        className="flex-1 rounded-md border border-white/10 bg-black/40 px-3 py-1.5 text-xs text-white"
                        data-testid="conditions-edit-input"
                      />
                      <button
                        type="button"
                        className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/20"
                        onClick={() => void handleSaveNote(row)}
                        data-testid="conditions-edit-save"
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
                        setEditingDescription(row.description ?? "");
                      }}
                      disabled={isPending}
                      data-testid="conditions-edit-toggle"
                    >
                      Edit note
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold text-emerald-100 hover:bg-emerald-500/20 disabled:opacity-60"
                    onClick={() => void handleStatus(row, "satisfied")}
                    disabled={isPending || status === "satisfied"}
                    data-testid="conditions-mark-satisfied"
                  >
                    Satisfy
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-[11px] font-semibold text-blue-100 hover:bg-blue-500/20 disabled:opacity-60"
                    onClick={() => void handleStatus(row, "waived")}
                    disabled={isPending || status === "waived"}
                    data-testid="conditions-mark-waived"
                  >
                    Waive
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
