"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Always-visible relationship notes card on the deal cockpit.
 * Auto-saves on blur. Available at every stage from deal creation.
 * Pre-populates BorrowerStoryForm.banker_notes when deal reaches Memo Inputs.
 */
export default function RelationshipNotesCard({ dealId }: { dealId: string }) {
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const lastSaved = useRef("");

  // Load on mount
  useEffect(() => {
    fetch(`/api/deals/${dealId}/relationship-notes`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const val = d?.banker_relationship_notes ?? "";
        setNotes(val);
        lastSaved.current = val;
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [dealId]);

  const save = useCallback(async () => {
    if (notes === lastSaved.current) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/relationship-notes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ banker_relationship_notes: notes }),
      });
      if (res.ok) {
        lastSaved.current = notes;
        setSavedAt(new Date().toLocaleTimeString());
      }
    } catch {
      // Silent — non-critical
    } finally {
      setSaving(false);
    }
  }, [dealId, notes]);

  if (!loaded) return null;

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <header className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Relationship Notes</h3>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          {saving && <span>Saving…</span>}
          {savedAt && !saving && <span className="text-emerald-600">Saved {savedAt}</span>}
        </div>
      </header>
      <textarea
        rows={4}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={save}
        placeholder="Client context, relationship history, pre-qualification notes…"
        className="w-full rounded-md border border-gray-300 p-2 text-sm focus:border-gray-500 focus:outline-none"
      />
    </section>
  );
}
