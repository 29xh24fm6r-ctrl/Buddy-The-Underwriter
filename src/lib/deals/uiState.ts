/**
 * Deal Workspace UI State Management
 * 
 * URL-driven state for panels, modals, focus
 * Makes UI shareable + back/forward friendly
 */

export type DealPanel = "pack" | "jobs" | "forms" | "conditions" | "messages" | "setup" | "upload" | "assignees" | "drafts";
export type DealModal = "assignUnderwriter" | "reviewDrafts" | "generateForm" | null;

interface DealUiStatePatch {
  panel?: DealPanel;
  modal?: DealModal | null;
  focus?: DealPanel;
}

/**
 * Build new URLSearchParams with UI state patches
 * Preserves other query params (like dealId, name, etc.)
 */
export function buildDealUrlState(params: URLSearchParams, patch: DealUiStatePatch): URLSearchParams {
  const next = new URLSearchParams(params);

  // Panel state (which collapsible is open)
  if (patch.panel !== undefined) {
    if (patch.panel) {
      next.set("panel", patch.panel);
    } else {
      next.delete("panel");
    }
  }

  // Focus state (which section is highlighted)
  if (patch.focus !== undefined) {
    if (patch.focus) {
      next.set("focus", patch.focus);
    } else {
      next.delete("focus");
    }
  }

  // Modal state (which modal is open)
  if (patch.modal !== undefined) {
    if (patch.modal === null) {
      next.delete("modal");
    } else {
      next.set("modal", patch.modal);
    }
  }

  return next;
}

/**
 * Read current UI state from URL params
 */
export function parseDealUiState(params: URLSearchParams) {
  return {
    panel: params.get("panel") as DealPanel | null,
    modal: params.get("modal") as DealModal | null,
    focus: params.get("focus") as DealPanel | null,
  };
}
