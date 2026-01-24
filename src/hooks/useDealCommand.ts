"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { DealCommand } from "@/lib/deals/commands";
import { buildDealUrlState } from "@/lib/deals/uiState";

/**
 * Scroll to element by ID with smooth behavior + highlight ring
 * Deterministic: always scrolls to same anchor for same ID
 */
function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) {
    console.warn(`[useDealCommand] Element with id="${id}" not found`);
    return;
  }

  // Smooth scroll with top alignment
  el.scrollIntoView({ behavior: "smooth", block: "start" });

  // Highlight with ring for 1.2s
  el.classList.add("ring-2", "ring-blue-500", "ring-offset-2");
  window.setTimeout(() => {
    el.classList.remove("ring-2", "ring-blue-500", "ring-offset-2");
  }, 1200);
}

/**
 * Execute deal workspace commands
 * 
 * Commands are deterministic: same command always produces same UI state
 * - Updates URL (shareable, back/forward friendly)
 * - Opens modals/panels
 * - Scrolls + highlights targets
 * 
 * Usage:
 *   const runCommand = useDealCommand();
 *   runCommand({ type: "ASSIGN_UNDERWRITER" });
 */
export function useDealCommand() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const safePathname = pathname ?? "";

  return useCallback(
    (cmd: DealCommand) => {
      const currentParams = new URLSearchParams(params?.toString() ?? "");

      switch (cmd.type) {
        case "ASSIGN_UNDERWRITER": {
          // Open modal + focus setup section
          const next = buildDealUrlState(currentParams, {
            modal: "assignUnderwriter",
            focus: "assignees",
          });
          router.replace(`${safePathname}?${next.toString()}`);
          scrollToId("assignees");
          return;
        }

        case "RUN_WORKER_TICK": {
          // Focus jobs panel + scroll to it
          const next = buildDealUrlState(currentParams, {
            panel: "jobs",
            focus: "jobs",
          });
          router.replace(`${safePathname}?${next.toString()}`);
          scrollToId("jobs");
          return;
        }

        case "RUN_OCR_ALL": {
          // Focus upload section (OCR is launched from there)
          const next = buildDealUrlState(currentParams, {
            panel: "upload",
            focus: "upload",
          });
          router.replace(`${safePathname}?${next.toString()}`);
          scrollToId("upload");
          return;
        }

        case "REVIEW_DRAFT_REQUESTS": {
          // Focus drafts section (new system - auto-generated requests)
          const next = buildDealUrlState(currentParams, {
            panel: "drafts",
            focus: "drafts",
          });
          router.replace(`${safePathname}?${next.toString()}`);
          scrollToId("drafts");
          return;
        }

        case "REVIEW_DRAFT_MESSAGES": {
          // Open drafts modal + focus messages section (old system)
          const next = buildDealUrlState(currentParams, {
            modal: "reviewDrafts",
            panel: "messages",
            focus: "messages",
          });
          router.replace(`${safePathname}?${next.toString()}`);
          scrollToId("messages");
          return;
        }

        case "REVIEW_CONDITIONS": {
          // Focus conditions section
          const next = buildDealUrlState(currentParams, {
            panel: "conditions",
            focus: "conditions",
          });
          router.replace(`${safePathname}?${next.toString()}`);
          scrollToId("conditions");
          return;
        }

        case "GENERATE_BANK_FORM": {
          // Open form generation modal + focus forms
          const next = buildDealUrlState(currentParams, {
            modal: "generateForm",
            panel: "forms",
            focus: "forms",
          });
          router.replace(`${safePathname}?${next.toString()}`);
          scrollToId("forms");
          return;
        }

        case "REQUEST_MISSING_DOCS": {
          // Focus conditions (where missing docs are shown)
          const next = buildDealUrlState(currentParams, {
            panel: "conditions",
            focus: "conditions",
          });
          router.replace(`${safePathname}?${next.toString()}`);
          scrollToId("conditions");
          return;
        }

        case "READY_TO_CLOSE": {
          // Focus conditions (final checklist)
          const next = buildDealUrlState(currentParams, {
            panel: "conditions",
            focus: "conditions",
          });
          router.replace(`${safePathname}?${next.toString()}`);
          scrollToId("conditions");
          return;
        }

        case "FOCUS_SECTION": {
          // Just scroll + highlight, no modal/panel change
          const next = buildDealUrlState(currentParams, {
            focus: cmd.section,
          });
          router.replace(`${safePathname}?${next.toString()}`);
          scrollToId(cmd.section);
          return;
        }

        default: {
          console.warn("[useDealCommand] Unknown command type:", cmd);
          return;
        }
      }
    },
    [params, pathname, router]
  );
}
