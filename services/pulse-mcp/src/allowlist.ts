/**
 * Read-only tools that do not require proposal/approval gating.
 * All Buddy observability tools are read-only by design.
 */
export const READ_TOOLS: readonly string[] = [
  "buddy.list_recent_errors",
  "buddy.get_deal_timeline",
  "buddy.get_deal_state",
  "buddy.list_stuck_deals",
  "buddy.list_incidents",
  "buddy.error_fingerprint_summary",
  "buddy.get_fingerprint_samples",
  "buddy_list_ledger_events",
  "buddy_get_deal_ledger",
] as const;

export function isReadTool(tool: string): boolean {
  return (READ_TOOLS as readonly string[]).includes(tool);
}
