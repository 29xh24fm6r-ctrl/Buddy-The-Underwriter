"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CrmModal } from "./CrmWorkspaceFrame";

export function CrmRecordDeleteControl({
  endpoint,
  label,
  recordType,
  consequence,
  redirectTo,
}: {
  endpoint: string;
  label: string;
  recordType: "company" | "person" | "lead";
  consequence: string;
  redirectTo: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    if (confirmation.trim() !== label.trim()) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(endpoint, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        if (payload.error === "record_in_use" && Array.isArray(payload.blockers)) {
          throw new Error(`This ${recordType} is still connected to ${payload.blockers.join(", ")}. Disconnect that work before deleting it.`);
        }
        throw new Error(payload.error === "confirmation_mismatch" ? "The confirmation did not match the record name." : "Deletion could not be confirmed.");
      }
      router.replace(redirectTo);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Deletion could not be confirmed.");
      setBusy(false);
    }
  }

  return (
    <section className="crm-danger-zone">
      <div><p className="crm-eyebrow">ADMIN CONTROLS</p><h2>Remove this {recordType}</h2><p>{consequence}</p></div>
      <button className="crm-danger-button" onClick={() => setOpen(true)}>Delete {recordType}</button>
      {open ? (
        <CrmModal title={`Permanently delete ${recordType}`} className="crm-delete-dialog" onClose={() => { if (!busy) setOpen(false); }}>
          <div className="crm-delete-confirmation">
            <span className="crm-delete-icon" aria-hidden="true">!</span>
            <h3>This cannot be undone.</h3>
            <p>{consequence} An audit receipt will record who performed this action.</p>
            <label>Type <strong>{label}</strong> to confirm<input autoFocus value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
            {error ? <p role="alert">{error}</p> : null}
            <div><button disabled={busy} onClick={() => setOpen(false)}>Keep {recordType}</button><button className="crm-danger-button" disabled={busy || confirmation.trim() !== label.trim()} onClick={() => void remove()}>{busy ? "Deleting…" : `Permanently delete ${recordType}`}</button></div>
          </div>
        </CrmModal>
      ) : null}
    </section>
  );
}

export function CrmActivityDeleteButton({ id, label, onDeleted }: { id: string; label: string; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function remove() {
    if (!window.confirm(`Delete “${label}” permanently? An audit receipt will be kept.`)) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/brokerage/crm/activities", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error();
      onDeleted();
    } catch {
      setError("Deletion was not confirmed. Refresh before trying again.");
      setBusy(false);
    }
  }
  return <span className="crm-activity-delete"><button disabled={busy} onClick={() => void remove()}>{busy ? "Deleting…" : "Delete"}</button>{error ? <small role="alert">{error}</small> : null}</span>;
}
