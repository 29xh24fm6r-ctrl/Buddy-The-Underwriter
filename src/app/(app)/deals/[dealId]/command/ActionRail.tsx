"use client";

import { useState } from "react";
import type { DealContext, DealAction } from "@/lib/deals/contextTypes";
import { EventsFeed } from "./EventsFeed";
import { ChecklistPanel } from "./ChecklistPanel";
import { CinematicTimeline } from "@/components/command/CinematicTimeline";
import { BuddyExplainsCard } from "@/components/deals/BuddyExplainsCard";

export function ActionRail({
  dealId,
  context,
}: {
  dealId: string;
  context: DealContext;
}) {
  const [processing, setProcessing] = useState<DealAction | null>(null);

  const handleAction = async (action: DealAction) => {
    setProcessing(action);
    try {
      const res = await fetch(`/api/deals/${dealId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });

      if (!res.ok) {
        throw new Error(`Action failed: ${res.status}`);
      }

      // Reload page to refresh context
      window.location.reload();
    } catch (e: any) {
      alert(`Error: ${e?.message ?? e}`);
    } finally {
      setProcessing(null);
    }
  };

  return (
    <div className="flex h-full flex-col p-6 space-y-6">
      <h2 className="text-lg font-semibold text-gray-900">
        What should I do next?
      </h2>

      {/* Completeness Stats */}
      <div className="space-y-2 rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">Missing Documents</span>
          <span className="font-semibold text-gray-900">
            {context.completeness.missingDocs}
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">Open Conditions</span>
          <span className="font-semibold text-gray-900">
            {context.completeness.openConditions}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-3">
        {context.permissions.canRequest && (
          <ActionButton
            action="request-document"
            label="Request Document"
            disabled={processing !== null}
            loading={processing === "request-document"}
            onClick={() => handleAction("request-document")}
          />
        )}

        <ActionButton
          action="mark-condition"
          label="Mark Condition Satisfied"
          disabled={processing !== null || context.completeness.openConditions === 0}
          loading={processing === "mark-condition"}
          onClick={() => handleAction("mark-condition")}
        />

        {context.permissions.canApprove && (
          <>
            <ActionButton
              action="approve"
              label="Approve Deal"
              variant="success"
              disabled={
                processing !== null ||
                context.completeness.missingDocs > 0 ||
                context.completeness.openConditions > 0
              }
              loading={processing === "approve"}
              onClick={() => handleAction("approve")}
            />

            <ActionButton
              action="decline"
              label="Decline Deal"
              variant="danger"
              disabled={processing !== null}
              loading={processing === "decline"}
              onClick={() => handleAction("decline")}
            />
          </>
        )}

        <ActionButton
          action="escalate"
          label="Escalate to Committee"
          disabled={processing !== null}
          loading={processing === "escalate"}
          onClick={() => handleAction("escalate")}
        />

        {context.permissions.canShare && (
          <ActionButton
            action="share"
            label="Share Deal"
            disabled={processing !== null}
            loading={processing === "share"}
            onClick={() => handleAction("share")}
          />
        )}
      </div>

      {/* Checklist Panel */}
      <ChecklistPanel dealId={dealId} />

      {/* Buddy Explains */}
      <BuddyExplainsCard dealId={dealId} />

      {/* Cinematic Timeline */}
      <CinematicTimeline dealId={dealId} />

      {/* Events Feed */}
      <EventsFeed dealId={dealId} />
    </div>
  );
}

function ActionButton({
  action,
  label,
  variant = "default",
  disabled,
  loading,
  onClick,
}: {
  action: DealAction;
  label: string;
  variant?: "default" | "success" | "danger";
  disabled: boolean;
  loading: boolean;
  onClick: () => void;
}) {
  const variantStyles = {
    default: "bg-blue-600 hover:bg-blue-700 text-white",
    success: "bg-green-600 hover:bg-green-700 text-white",
    danger: "bg-red-600 hover:bg-red-700 text-white",
  }[variant];

  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`w-full rounded-lg px-4 py-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${variantStyles}`}
    >
      {loading ? "Processing..." : label}
    </button>
  );
}
