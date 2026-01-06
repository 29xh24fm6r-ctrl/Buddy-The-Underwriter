export const UI_EVENT_CHECKLIST_REFRESH = "buddy:checklist:refresh";

export function emitChecklistRefresh(dealId: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(UI_EVENT_CHECKLIST_REFRESH, { detail: { dealId } }));
}

export function onChecklistRefresh(dealId: string, callback: () => void) {
  if (typeof window === "undefined") return () => {};
  
  const handler = (e: Event) => {
    const customEvent = e as CustomEvent<{ dealId: string }>;
    if (customEvent.detail?.dealId === dealId) {
      callback();
    }
  };
  
  window.addEventListener(UI_EVENT_CHECKLIST_REFRESH, handler);
  return () => window.removeEventListener(UI_EVENT_CHECKLIST_REFRESH, handler);
}
