"use client";
import { useEffect } from "react";

export function useCrmDraftGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const navigate = (event: MouseEvent) => {
      const link = (event.target as HTMLElement).closest?.("a[href]");
      if (
        !link ||
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.button !== 0
      )
        return;
      if (
        !window.confirm(
          "You have an unsaved draft. Leave this page and discard it?",
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", navigate, true);
    };
  }, [dirty]);
}

export function confirmCrmDiscard(root: ParentNode | null = document) {
  return (
    !root?.querySelector('[data-crm-dirty="true"]') ||
    window.confirm("Discard your unsaved draft?")
  );
}
