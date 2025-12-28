"use client";

import * as React from "react";
import { Send, Link as LinkIcon, CheckCircle, AlertCircle } from "lucide-react";

interface Props {
  dealId: string;
}

export function BorrowerPortalControls({ dealId }: Props) {
  const [phone, setPhone] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState<{
    type: "success" | "error" | null;
    text: string;
  }>({ type: null, text: "" });

  async function createAndSendLink() {
    if (!phone.trim()) {
      setStatus({ type: "error", text: "Phone number required" });
      return;
    }

    setBusy(true);
    setStatus({ type: null, text: "" });

    try {
      // Step 1: Create link
      const createRes = await fetch("/api/portal/create-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deal_id: dealId }),
      });

      if (!createRes.ok) {
        const err = await createRes.json();
        throw new Error(err.error || "Failed to create link");
      }

      const { token, portal_url } = await createRes.json();

      // Step 2: Send via SMS
      const sendRes = await fetch("/api/portal/send-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          deal_id: dealId,
          to_phone: phone,
          message: message.trim() || undefined,
        }),
      });

      const sendData = await sendRes.json();

      if (!sendData.ok) {
        // Link created but SMS failed
        setStatus({
          type: "error",
          text: `SMS failed: ${sendData.error}. Link: ${portal_url}`,
        });
        return;
      }

      setStatus({
        type: "success",
        text: `SMS sent! Token: ${token.substring(0, 8)}...`,
      });

      // Reset form
      setPhone("");
      setMessage("");
    } catch (e: any) {
      setStatus({ type: "error", text: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <LinkIcon className="h-5 w-5 text-neutral-700" />
        <h3 className="text-sm font-semibold text-neutral-900">
          Borrower Portal
        </h3>
      </div>

      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-700">
            Borrower Phone
          </label>
          <input
            type="tel"
            placeholder="+15551234567"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={busy}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900/20 disabled:opacity-60"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-700">
            Custom Message (optional)
          </label>
          <textarea
            placeholder="Upload your documents here..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            disabled={busy}
            rows={2}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900/20 disabled:opacity-60"
          />
        </div>

        <button
          type="button"
          onClick={createAndSendLink}
          disabled={busy || !phone.trim()}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-900 disabled:opacity-60"
        >
          <Send className="h-4 w-4" />
          {busy ? "Sending..." : "Send Upload Link"}
        </button>

        {status.type && (
          <div
            className={[
              "flex items-start gap-2 rounded-lg p-3 text-sm",
              status.type === "success"
                ? "bg-emerald-50 text-emerald-900"
                : "bg-red-50 text-red-900",
            ].join(" ")}
          >
            {status.type === "success" ? (
              <CheckCircle className="h-4 w-4 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0" />
            )}
            <div className="min-w-0 flex-1 text-xs">{status.text}</div>
          </div>
        )}
      </div>
    </div>
  );
}
