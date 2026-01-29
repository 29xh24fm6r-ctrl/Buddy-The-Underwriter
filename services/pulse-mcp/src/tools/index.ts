import {
  buddy_list_recent_errors,
  buddy_get_deal_timeline,
  buddy_get_deal_state,
  buddy_list_stuck_deals,
  buddy_list_incidents,
  buddy_error_fingerprint_summary,
  buddy_get_fingerprint_samples,
} from "./buddy_observability";

import {
  buddy_list_ledger_events,
  buddy_get_deal_ledger,
} from "./buddy/ledger";

export const tools: Record<string, (args: any) => Promise<any>> = {
  "buddy.list_recent_errors": buddy_list_recent_errors,
  "buddy.get_deal_timeline": buddy_get_deal_timeline,
  "buddy.get_deal_state": buddy_get_deal_state,
  "buddy.list_stuck_deals": buddy_list_stuck_deals,
  "buddy.list_incidents": buddy_list_incidents,

  "buddy.error_fingerprint_summary": buddy_error_fingerprint_summary,
  "buddy.get_fingerprint_samples": buddy_get_fingerprint_samples,

  "buddy_list_ledger_events": buddy_list_ledger_events,
  "buddy_get_deal_ledger": buddy_get_deal_ledger,
};
