"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import MemoInputSuggestionsPanel from "./MemoInputSuggestionsPanel";

/**
 * Wraps MemoInputSuggestionsPanel with API-write behavior. When the banker
 * accepts a suggestion, the bridge calls the matching upsert endpoint and
 * refreshes the page so the newly persisted value flows into the form.
 */
export default function MemoInputSuggestionsBridge({ dealId }: { dealId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAccept(path: string[], value: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (path[0] === "borrower_story" && path[1]) {
        await fetch(`/api/deals/${dealId}/memo-inputs`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [path[1]]: value }),
        });
      } else if (path[0] === "management_profiles") {
        await fetch(`/api/deals/${dealId}/memo-inputs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "management", person_name: value }),
        });
      } else if (path[0] === "collateral_items") {
        await fetch(`/api/deals/${dealId}/memo-inputs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "collateral",
            collateral_type: "general",
            description: value,
          }),
        });
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <MemoInputSuggestionsPanel dealId={dealId} onAccept={handleAccept} />
      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-2 text-xs text-rose-700">
          {error}
        </div>
      ) : null}
    </div>
  );
}
