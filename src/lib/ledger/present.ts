/**
 * Present ledger events for UI display
 */

const EVENT_TITLES: Record<string, string> = {
  "checklist.seeded": "Checklist seeded",
  "checklist.item.upserted": "Checklist item updated",
  "checklist.status.set": "Checklist status changed",
  "underwrite.started": "Underwriting started",
  "intake.updated": "Intake updated",
  "document.uploaded": "Document uploaded",
  "deal.created": "Deal created",
  "deal.assigned": "Deal assigned",
};

function humanizeKind(kind: string): string {
  return kind
    .split(".")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function presentEvent(event: {
  kind: string;
  input_json?: any;
  created_at: string;
}): { title: string; detail?: string } {
  const title = EVENT_TITLES[event.kind] || humanizeKind(event.kind);
  
  // Extract detail from input_json if available
  let detail: string | undefined;
  
  if (event.input_json) {
    if (typeof event.input_json === "object") {
      const input = event.input_json as any;
      
      // Try common detail fields
      if (input.checklist_key) {
        detail = input.checklist_key;
      } else if (input.status) {
        detail = `Status: ${input.status}`;
      } else if (input.count_inserted !== undefined) {
        detail = `${input.count_inserted} items`;
      } else if (input.filename) {
        detail = input.filename;
      }
    }
  }
  
  return { title, detail };
}
