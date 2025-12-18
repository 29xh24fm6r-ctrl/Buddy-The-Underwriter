/**
 * Deal Workspace Command Bus
 * 
 * Turns nextAction.type into deterministic commands that:
 * - Update URL state (shareable, back/forward friendly)
 * - Open modals/panels
 * - Scroll + highlight targets
 * - Log audit events
 * 
 * NO AI. NO GUESSING. Pure deterministic routing.
 */

export type DealCommand =
  | { type: "ASSIGN_UNDERWRITER" }
  | { type: "RUN_WORKER_TICK" }
  | { type: "RUN_OCR_ALL" }
  | { type: "REVIEW_DRAFT_REQUESTS" }
  | { type: "REVIEW_DRAFT_MESSAGES" }
  | { type: "REVIEW_CONDITIONS" }
  | { type: "GENERATE_BANK_FORM" }
  | { type: "REQUEST_MISSING_DOCS" }
  | { type: "READY_TO_CLOSE" }
  | { type: "FOCUS_SECTION"; section: "setup" | "upload" | "jobs" | "forms" | "conditions" | "messages" | "assignees" | "pack" | "drafts" };

/**
 * Map Next Best Action type to executable command
 * Deterministic: same action_id always produces same command
 */
export function commandForNextAction(actionType: string): DealCommand {
  switch (actionType) {
    case "ASSIGN_UNDERWRITER":
      return { type: "ASSIGN_UNDERWRITER" };
    
    case "RUN_WORKER_TICK":
      return { type: "RUN_WORKER_TICK" };
    
    case "RUN_OCR_ALL":
      return { type: "RUN_OCR_ALL" };
    
    case "REVIEW_DRAFT_REQUESTS":
      return { type: "REVIEW_DRAFT_REQUESTS" };
    
    case "REVIEW_DRAFT_MESSAGES":
      return { type: "REVIEW_DRAFT_MESSAGES" };
    
    case "REVIEW_CONDITIONS":
      return { type: "REVIEW_CONDITIONS" };
    
    case "GENERATE_BANK_FORM":
      return { type: "GENERATE_BANK_FORM" };
    
    case "REQUEST_MISSING_DOCS":
      return { type: "REQUEST_MISSING_DOCS" };
    
    case "READY_TO_CLOSE":
      return { type: "READY_TO_CLOSE" };
    
    default:
      // Fallback: focus conditions
      return { type: "FOCUS_SECTION", section: "conditions" };
  }
}

/**
 * Get human-readable description of command (for audit logs)
 */
export function describeCommand(cmd: DealCommand): string {
  switch (cmd.type) {
    case "ASSIGN_UNDERWRITER":
      return "Open underwriter assignment modal";
    case "RUN_WORKER_TICK":
      return "Execute worker tick to process failed jobs";
    case "RUN_OCR_ALL":
      return "Enqueue OCR jobs for all eligible uploads";
    case "REVIEW_DRAFT_REQUESTS":
      return "Review auto-generated borrower document requests";
    case "REVIEW_DRAFT_MESSAGES":
      return "Review and approve draft messages";
    case "REVIEW_CONDITIONS":
      return "Review outstanding conditions to close";
    case "GENERATE_BANK_FORM":
      return "Generate bank form from template";
    case "REQUEST_MISSING_DOCS":
      return "Request missing documents from borrower";
    case "READY_TO_CLOSE":
      return "Deal ready to close - view final checklist";
    case "FOCUS_SECTION":
      return `Focus on ${cmd.section} section`;
  }
}
