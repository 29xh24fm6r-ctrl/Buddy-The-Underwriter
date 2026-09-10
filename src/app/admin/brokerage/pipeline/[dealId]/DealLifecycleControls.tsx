"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CrmModal } from "@/components/brokerage/CrmWorkspaceFrame";
import { brokerageColors as c } from "@/components/brokerage/tokens";

export default function DealLifecycleControls({ dealId, label, archivedAt }: { dealId: string; label: string; archivedAt: string | null }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"archive" | "restore" | "delete" | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function changeLifecycle(action: "archive" | "restore") {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/admin/brokerage/deals/${dealId}/lifecycle`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error("The change was not confirmed. Refresh and try again.");
      router.replace(action === "archive" ? "/admin/brokerage/pipeline?view=archived" : "/admin/brokerage/pipeline");
      router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The change was not confirmed."); setBusy(false); }
  }

  async function permanentlyDelete() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/admin/brokerage/deals/${dealId}/lifecycle`, {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        if (payload.error === "record_in_use") throw new Error("This deal has protected operational records. Keep it archived so its history remains intact.");
        if (payload.error === "archive_required") throw new Error("Archive the deal before permanently deleting it.");
        if (payload.error === "confirmation_mismatch") throw new Error("The deal name did not match.");
        throw new Error("Deletion was not confirmed. Nothing was removed.");
      }
      router.replace("/admin/brokerage/pipeline?view=archived"); router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Deletion was not confirmed."); setBusy(false); }
  }

  const button: React.CSSProperties = { border: `1px solid ${c.border}`, borderRadius: 5, padding: "8px 11px", background: c.inkHeader, color: c.textSecondary, cursor: "pointer", fontSize: 11 };
  return (
    <section style={{ marginTop: 24, border: `1px solid ${archivedAt ? c.brass : c.border}`, borderRadius: 8, padding: 16, background: c.card, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
      <div><div style={{ color: c.paper, fontWeight: 700, fontSize: 13 }}>Admin deal controls</div><div style={{ color: c.textMuted, fontSize: 11, marginTop: 4 }}>{archivedAt ? "Archived deals are hidden from daily work and can be restored." : "Archive removes this deal from daily work without destroying its history."}</div></div>
      <div style={{ display: "flex", gap: 8 }}>
        <button style={button} onClick={() => setDialog(archivedAt ? "restore" : "archive")}>{archivedAt ? "Restore deal" : "Archive deal"}</button>
        {archivedAt ? <button style={{ ...button, color: c.brick, borderColor: c.brick }} onClick={() => setDialog("delete")}>Permanently delete</button> : null}
      </div>
      {dialog ? <CrmModal className="crm-delete-dialog" title={dialog === "delete" ? "Permanently delete deal" : dialog === "archive" ? "Archive deal" : "Restore deal"} onClose={() => { if (!busy) { setDialog(null); setError(""); } }}>
        <div className="crm-delete-confirmation">
          <h3>{dialog === "delete" ? "This cannot be undone." : dialog === "archive" ? "Move this deal out of daily work?" : "Return this deal to the active pipeline?"}</h3>
          <p>{dialog === "delete" ? "Its database record and unprotected connected records will be removed. Protected operational history blocks deletion, and an audit receipt records this attempt." : dialog === "archive" ? "You can restore it later from Archived deals." : "It will reappear in the active pipeline."}</p>
          {dialog === "delete" ? <label>Type <strong>{label}</strong> to confirm<input autoFocus value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label> : null}
          {error ? <p role="alert">{error}</p> : null}
          <div><button disabled={busy} onClick={() => setDialog(null)}>Cancel</button><button className={dialog === "delete" ? "crm-danger-button" : undefined} disabled={busy || (dialog === "delete" && confirmation.trim() !== label.trim())} onClick={() => void (dialog === "delete" ? permanentlyDelete() : changeLifecycle(dialog))}>{busy ? "Working…" : dialog === "delete" ? "Permanently delete deal" : dialog === "archive" ? "Archive deal" : "Restore deal"}</button></div>
        </div>
      </CrmModal> : null}
    </section>
  );
}
