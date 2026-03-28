"use client";

/**
 * Phase 65F — Borrower Reminder Controls
 *
 * Banker controls for campaign reminders: pause, resume, manual send.
 */

import { useState, useCallback } from "react";

export function BorrowerReminderControls({
  dealId,
  campaignId,
  isPaused,
  onStatusChange,
}: {
  dealId: string;
  campaignId: string;
  isPaused: boolean;
  onStatusChange?: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const handlePause = useCallback(async () => {
    setBusy(true);
    try {
      await fetch(
        `/api/deals/${dealId}/borrower-campaigns/${campaignId}/pause`,
        { method: "POST" },
      );
      onStatusChange?.();
    } finally {
      setBusy(false);
    }
  }, [dealId, campaignId, onStatusChange]);

  const handleResend = useCallback(async () => {
    setBusy(true);
    try {
      await fetch(
        `/api/deals/${dealId}/borrower-campaigns/${campaignId}/resend`,
        { method: "POST" },
      );
      onStatusChange?.();
    } finally {
      setBusy(false);
    }
  }, [dealId, campaignId, onStatusChange]);

  return (
    <div
      data-testid="borrower-reminder-controls"
      className="flex items-center gap-2"
    >
      {!isPaused && (
        <button
          type="button"
          disabled={busy}
          onClick={handlePause}
          className="rounded border border-neutral-300 bg-white px-2 py-0.5 text-[10px] font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
        >
          {busy ? "..." : "Pause Reminders"}
        </button>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={handleResend}
        className="rounded border border-neutral-300 bg-white px-2 py-0.5 text-[10px] font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
      >
        {busy ? "..." : "Send Now"}
      </button>
    </div>
  );
}
