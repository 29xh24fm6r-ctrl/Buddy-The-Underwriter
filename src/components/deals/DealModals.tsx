"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { buildDealUrlState, parseDealUiState } from "@/lib/deals/uiState";
import { useState } from "react";

interface DealModalsProps {
  dealId: string;
}

/**
 * Deal Workspace Modals
 * 
 * All modals driven by URL state (?modal=xyz)
 * - Shareable (copy URL → same modal opens)
 * - Back/forward friendly
 * - Deterministic (no local state drift)
 */
export default function DealModals({ dealId }: DealModalsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const safePathname = pathname ?? "";
  const safeParams = params ?? new URLSearchParams();

  const uiState = parseDealUiState(safeParams);

  const closeModal = () => {
    const next = buildDealUrlState(new URLSearchParams(safeParams.toString()), { modal: null });
    router.replace(`${safePathname}?${next.toString()}`);
  };

  // Render active modal based on URL state
  if (uiState.modal === "assignUnderwriter") {
    return <AssignUnderwriterModal dealId={dealId} open onClose={closeModal} />;
  }

  if (uiState.modal === "reviewDrafts") {
    return <ReviewDraftsModal dealId={dealId} open onClose={closeModal} />;
  }

  if (uiState.modal === "generateForm") {
    return <GenerateFormModal dealId={dealId} open onClose={closeModal} />;
  }

  return null;
}

/**
 * Assign Underwriter Modal
 * Opens when URL has ?modal=assignUnderwriter
 */
function AssignUnderwriterModal(props: { dealId: string; open: boolean; onClose: () => void }) {
  const [selectedUserId, setSelectedUserId] = useState("");
  const [saving, setSaving] = useState(false);

  if (!props.open) return null;

  const handleAssign = async () => {
    if (!selectedUserId) {
      alert("Please enter an underwriter user ID");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/deals/${props.dealId}/participants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: selectedUserId,
          role: "underwriter",
        }),
      });

      const j = await res.json().catch(() => null);
      if (!j?.ok) throw new Error(j?.error ?? "Failed to assign underwriter");

      alert("Underwriter assigned successfully!");
      props.onClose();
      window.location.reload();
    } catch (err) {
      console.error("Error assigning underwriter:", err);
      alert("Failed to assign underwriter. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Assign Underwriter</h2>
          <button
            onClick={props.onClose}
            className="rounded px-2 py-1 hover:bg-gray-100 text-gray-600"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Underwriter Clerk User ID
            </label>
            <input
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              placeholder="user_..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <p className="mt-2 text-xs text-gray-500">
              Assignment requires super-admin or deal bank-admin.
            </p>
          </div>

          <div className="flex gap-3 pt-4 border-t">
            <button
              onClick={props.onClose}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              disabled={saving}
            >
              Cancel
            </button>
            <button
              onClick={handleAssign}
              disabled={saving || !selectedUserId}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "Assigning..." : "Assign"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Review Drafts Modal
 * Opens when URL has ?modal=reviewDrafts
 */
function ReviewDraftsModal(props: { dealId: string; open: boolean; onClose: () => void }) {
  if (!props.open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Review Draft Messages</h2>
          <button
            onClick={props.onClose}
            className="rounded px-2 py-1 hover:bg-gray-100 text-gray-600"
          >
            ✕
          </button>
        </div>

        <div className="text-sm text-gray-600 mb-4">
          <p>Approve draft messages before sending to borrower.</p>
          <p className="text-xs text-gray-500 mt-1">
            Approving sends + logs activity automatically.
          </p>
        </div>

        <div className="text-center py-8">
          <p className="text-sm text-gray-500">
            Draft messages will appear here for review.
          </p>
          <p className="text-xs text-gray-400 mt-2">
            Component will be wired to DraftMessagesCard data.
          </p>
        </div>

        <div className="flex justify-end pt-4 border-t">
          <button
            onClick={props.onClose}
            className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Generate Form Modal
 * Opens when URL has ?modal=generateForm
 */
function GenerateFormModal(props: { dealId: string; open: boolean; onClose: () => void }) {
  if (!props.open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Generate Bank Form</h2>
          <button
            onClick={props.onClose}
            className="rounded px-2 py-1 hover:bg-gray-100 text-gray-600"
          >
            ✕
          </button>
        </div>

        <div className="text-sm text-gray-600 mb-4">
          <p>Review auto-filled data and generate PDF form.</p>
          <p className="text-xs text-gray-500 mt-1">
            Forms are auto-filled from OCR data with review step.
          </p>
        </div>

        <div className="text-center py-8">
          <p className="text-sm text-gray-500">
            Form generation workflow will appear here.
          </p>
          <p className="text-xs text-gray-400 mt-2">
            Component will be wired to BankFormsCard workflow.
          </p>
        </div>

        <div className="flex justify-end pt-4 border-t">
          <button
            onClick={props.onClose}
            className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
