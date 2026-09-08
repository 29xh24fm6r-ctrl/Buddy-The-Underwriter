"use client";
import React, { useRef, useState } from "react";

export function CrmTaskControl({ id, completed, dueAt, onSaved }: { id: string; completed: boolean; dueAt?: string | null; onSaved: () => void }) {
  const [busy, setBusy] = useState(false); const lock = useRef(false); const [error, setError] = useState("");
  const [date, setDate] = useState(""); const [editing, setEditing] = useState(false);
  async function update(action: "complete" | "reopen" | "reschedule") {
    if (lock.current) return;
    if (action === "reschedule" && !Number.isFinite(Date.parse(date))) { setError("Choose a valid date and time."); return; }
    lock.current = true; setBusy(true); setError("");
    try {
      const r = await fetch("/api/admin/brokerage/crm/activities", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action, ...(action === "reschedule" ? { dueAt: new Date(date).toISOString() } : {}) }) });
      const j = await r.json(); if (!r.ok || !j.ok || j.activity?.id !== id) throw new Error();
      setEditing(false); onSaved();
    } catch { setError("Update not confirmed. Refresh before retrying."); }
    finally { lock.current = false; setBusy(false); }
  }
  return <div className="crm-task-control"><span>{completed ? "Completed" : dueAt ? `Due ${new Date(dueAt).toLocaleString()}` : "No due date"}</span><div><button disabled={busy} onClick={() => void update(completed ? "reopen" : "complete")}>{busy ? "Saving…" : completed ? "Reopen task" : "✓ Complete"}</button><button disabled={busy} onClick={() => setEditing(v => !v)}>Reschedule</button></div>{editing && <label>New due date (local time)<input type="datetime-local" value={date} onChange={e => setDate(e.target.value)} /><button disabled={busy} onClick={() => void update("reschedule")}>Save date</button></label>}{error && <p role="alert">{error}</p>}</div>;
}
