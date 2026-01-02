export const UI_EVENT_CHECKLIST_REFRESH = "buddy:checklist:refresh";

export function emitChecklistRefresh(dealId: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(UI_EVENT_CHECKLIST_REFRESH, { detail: { dealId } }));
}
