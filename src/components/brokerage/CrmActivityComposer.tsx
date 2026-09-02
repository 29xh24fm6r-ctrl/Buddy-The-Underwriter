"use client";

import React, { useRef, useState } from "react";
import { activityPayload, saveActivityDraft, type ActivityDraft } from "@/lib/crm/activityDraft";

export function CrmActivityComposer({ organizationId, organizationName, onSaved }: {
  organizationId: string; organizationName: string; onSaved: () => void;
}) {
  const [draft, setDraft] = useState<ActivityDraft>({ kind: "note", title: "", body: "", due: "" });
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    setError(""); setMessage("");
    try { activityPayload(organizationId, draft); }
    catch (e) { setError((e as Error).message); return; }
    lock.current = true; setBusy(true);
    try {
      await saveActivityDraft(organizationId, draft);
      setDraft({ kind: draft.kind, title: "", body: "", due: "" });
      setMessage(draft.kind === "task" ? "Follow-up saved to this relationship." : "Activity saved to this relationship.");
      onSaved();
    } catch { setError("Save could not be confirmed. Check relationship history before retrying to avoid duplicates. Your draft is preserved."); }
    finally { lock.current = false; setBusy(false); }
  }
  return <form className="crm-experience crm-composer" onSubmit={save} aria-label={`Record activity for ${organizationName}`}>
    <h2>Move this relationship forward</h2>
    <p>{organizationName} · Record what happened or set the next follow-up.</p>
    <fieldset disabled={busy}>
      <legend className="crm-small">What would you like to do?</legend>
      <div className="crm-quick-views">{([ ["note", "Add note"], ["call", "Log call"], ["meeting", "Log meeting"], ["task", "Set follow-up"] ] as const).map(([kind, label]) => <button type="button" key={kind} aria-pressed={draft.kind === kind} onClick={() => { setDraft({ ...draft, kind }); setMessage(""); }}>{label}</button>)}</div>
      <label>Short description<input required maxLength={200} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder={draft.kind === "task" ? "Call Dana about the referral" : "What happened?"} /></label>
      {draft.kind === "task" && <label>Due date and time (your local time)<input required type="datetime-local" value={draft.due} onChange={e => setDraft({ ...draft, due: e.target.value })} /></label>}
      <label>Details (optional)<textarea maxLength={10000} rows={3} value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value })} placeholder="Context, outcome, or what needs to happen next…" /></label>
      <p className="crm-small">{draft.kind === "task" ? "Creates a CRM task, not a calendar invitation or an automatic message." : "Logs activity only. Does not place a call, send a message, or create a calendar event."}</p>
      <button className="crm-button" type="submit">{busy ? "Saving…" : draft.kind === "task" ? "Save follow-up" : "Save activity"}</button>
    </fieldset>
    {message && <p role="status">✓ {message}</p>}{error && <p role="alert">{error}</p>}
  </form>;
}
