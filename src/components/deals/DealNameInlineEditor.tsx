"use client";

import * as React from "react";
import { Icon } from "@/components/ui/Icon";
import { resolveDealLabel } from "@/lib/deals/dealLabel";
import { useToast } from "@/hooks/use-toast";

type DealNameInlineEditorProps = {
  dealId: string;
  displayName?: string | null;
  nickname?: string | null;
  borrowerName?: string | null;
  size?: "sm" | "md" | "lg";
  onUpdated?: (next: { displayName: string | null; nickname: string | null }) => void;
};

export default function DealNameInlineEditor({
  dealId,
  displayName: initialDisplayName,
  nickname: initialNickname,
  borrowerName,
  size = "md",
  onUpdated,
}: DealNameInlineEditorProps) {
  const { toast } = useToast();
  const [displayName, setDisplayName] = React.useState<string | null>(initialDisplayName ?? null);
  const [nickname, setNickname] = React.useState<string | null>(initialNickname ?? null);
  const [editing, setEditing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [draftDisplayName, setDraftDisplayName] = React.useState(displayName ?? "");
  const [draftNickname, setDraftNickname] = React.useState(nickname ?? "");
  const [copyToast, setCopyToast] = React.useState<string | null>(null);
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    setDisplayName(initialDisplayName ?? null);
    setNickname(initialNickname ?? null);
  }, [initialDisplayName, initialNickname]);

  React.useEffect(() => {
    if (hydrated) return;
    if (initialDisplayName !== undefined || initialNickname !== undefined || borrowerName !== undefined) {
      setHydrated(true);
      return;
    }

    let cancelled = false;
    fetch(`/api/deals/${dealId}/name`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled || !json?.ok) return;
        setDisplayName(json.display_name ?? null);
        setNickname(json.nickname ?? null);
        setHydrated(true);
      })
      .catch(() => {
        if (!cancelled) setHydrated(true);
      });

    return () => {
      cancelled = true;
    };
  }, [dealId, hydrated, initialDisplayName, initialNickname, borrowerName]);

  const labelResult = React.useMemo(
    () =>
      resolveDealLabel({
        id: dealId,
        display_name: displayName ?? null,
        nickname: nickname ?? null,
        borrower_name: borrowerName ?? null,
      }),
    [dealId, displayName, nickname, borrowerName]
  );

  const textSize =
    size === "lg"
      ? "text-2xl md:text-3xl"
      : size === "sm"
      ? "text-base"
      : "text-xl";

  async function handleSave() {
    setSaving(true);
    setError(null);

    const payload = {
      display_name: draftDisplayName.trim() || null,
      nickname: draftNickname.trim() || null,
    };

    try {
      const res = await fetch(`/api/deals/${dealId}/name`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Failed to update deal name");
      }

      setDisplayName(json.display_name ?? null);
      setNickname(json.nickname ?? null);
      setEditing(false);
      toast({ title: "Deal name updated", detail: "Saved to your pipeline." });
      onUpdated?.({ displayName: json.display_name ?? null, nickname: json.nickname ?? null });
    } catch (err: any) {
      setError(err?.message ?? "Failed to update deal name");
    } finally {
      setSaving(false);
    }
  }

  function handleCopy(text: string) {
    if (!text) return;
    navigator.clipboard
      .writeText(text)
      .then(() => setCopyToast("Copied"))
      .catch(() => setCopyToast("Copy failed"))
      .finally(() => {
        window.setTimeout(() => setCopyToast(null), 1200);
      });
  }

  function startEditing() {
    setDraftDisplayName(displayName ?? "");
    setDraftNickname(nickname ?? "");
    setEditing(true);
    setError(null);
  }

  return (
    <div className="flex flex-col gap-2">
      {!editing ? (
        <div className="flex flex-wrap items-center gap-2">
          <div className={`font-semibold text-neutral-900 ${textSize}`}>{labelResult.label}</div>
          {labelResult.needsName && (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
              Needs name
            </span>
          )}
          {labelResult.source !== "fallback" ? (
            <button
              type="button"
              onClick={() => handleCopy(labelResult.label)}
              className="inline-flex items-center rounded-full border border-neutral-200 px-2.5 py-1 text-[11px] font-semibold text-neutral-600 hover:bg-neutral-50"
            >
              {copyToast ?? "Copy"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={startEditing}
            className="inline-flex items-center gap-1 rounded-full border border-neutral-200 px-2.5 py-1 text-[11px] font-semibold text-neutral-700 hover:bg-neutral-50"
          >
            <Icon name="description" className="h-3.5 w-3.5" />
            Edit
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-xl border border-neutral-200 bg-white p-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-neutral-600">Deal Name</label>
            <input
              value={draftDisplayName}
              onChange={(e) => setDraftDisplayName(e.target.value)}
              placeholder="Harbor Point Multifamily"
              className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-900"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-neutral-600">Nickname (optional)</label>
            <input
              value={draftNickname}
              onChange={(e) => setDraftNickname(e.target.value)}
              placeholder="HP - Austin"
              className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-900"
            />
          </div>
          {error ? <div className="text-xs text-rose-600">{error}</div> : null}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-3 py-2 text-xs font-semibold text-white hover:bg-neutral-800 disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
