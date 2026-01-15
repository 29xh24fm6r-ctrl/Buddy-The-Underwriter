/**
 * WOW++++++++ POLISH INTEGRATION GUIDE
 * 
 * This guide shows how to integrate the subtle polish components
 * into your deal pages.
 */

// =============================================================================
// 1. SOFT CONFIRMATIONS - Subtle, auto-dismissing feedback
// =============================================================================

import { useSoftConfirmations } from "@/lib/ui/useSoftConfirmations";
import { SoftConfirmationStack } from "@/components/ui/SoftConfirmationStack";

function DealPage() {
  const confirm = useSoftConfirmations();

  // Trigger on REAL state changes only (not on page load)
  const handleChecklistUpdate = async () => {
    await updateChecklist();
    confirm.push("Checklist updated");
  };

  const handleDocumentMatch = async () => {
    await matchDocument();
    confirm.push("Document matched to Financials (2023)");
  };

  const handleDealReady = async () => {
    await markReady();
    confirm.push("Deal is now ready");
  };

  return (
    <div>
      <SoftConfirmationStack items={confirm.items} />
      {/* Rest of page */}
    </div>
  );
}

// =============================================================================
// 2. LEDGER SNIPPETS - Build trust through history
// =============================================================================

import { DealLedgerSnippet } from "@/components/deals/DealLedgerSnippet";
import { getLatestLedgerEvent } from "@/lib/deals/getLatestLedgerEvent";

function DealStatusSection({ ledgerEvents }) {
  const latestEvent = getLatestLedgerEvent(ledgerEvents);

  return (
    <div>
      <DealStatusHeader mode={dealMode} />
      <DealLedgerSnippet event={latestEvent} />
    </div>
  );
}

// =============================================================================
// 3. SPINNER RULE - Only show when actually processing
// =============================================================================

// ❌ DON'T: Show spinner for empty/initializing state
if (checklist.length === 0) {
  return <Spinner />;
}

// ✅ DO: Show calm language instead
if (checklist.length === 0) {
  return <div>Initializing checklist…</div>;
}

// ✅ DO: Only show spinner for active work
if (uploadsInProgress > 0) {
  return <div>{uploadsInProgress} documents processing…</div>;
}

// =============================================================================
// 4. COLOR RULES - Red is sacred
// =============================================================================

// ❌ DON'T: Red for loading/empty/waiting
<div className="bg-red-500">Loading...</div>

// ✅ DO: Red ONLY for blockers
const bgColor = mode === "blocked" 
  ? "bg-red-500/10" 
  : mode === "ready"
  ? "bg-green-500/10"
  : "bg-amber-500/10"; // All intermediate states

// =============================================================================
// 5. COMPLETE EXAMPLE - Deal Command Center
// =============================================================================

export function DealCommandCenter({ dealId }) {
  const confirm = useSoftConfirmations();
  const [ledgerEvents, setLedgerEvents] = useState([]);
  const [dealMode, setDealMode] = useState<DealMode>("initializing");

  // Fetch ledger events
  useEffect(() => {
    async function load() {
      const res = await fetch(`/api/deals/${dealId}/ledger`);
      const data = await res.json();
      setLedgerEvents(data.events);
    }
    load();
  }, [dealId]);

  const latestEvent = getLatestLedgerEvent(ledgerEvents);

  return (
    <div className="space-y-4">
      {/* Soft confirmations */}
      <SoftConfirmationStack items={confirm.items} />

      {/* Status header with ledger snippet */}
      <div>
        <DealStatusHeader mode={dealMode} />
        <DealLedgerSnippet event={latestEvent} />
      </div>

      {/* Rest of page */}
      <ChecklistPanel dealId={dealId} />
    </div>
  );
}

// =============================================================================
// TRIGGER EXAMPLES - When to show confirmations
// =============================================================================

// ✅ DO: On successful state transitions
confirm.push("Checklist updated");
confirm.push("Document matched to Business Tax Returns (2023)");
confirm.push("Auto-seed completed");
confirm.push("Deal is now ready");

// ❌ DON'T: On page load
useEffect(() => {
  confirm.push("Page loaded"); // NO!
}, []);

// ❌ DON'T: On every refresh
useEffect(() => {
  fetchData();
  confirm.push("Data refreshed"); // NO!
}, []);

// ❌ DON'T: On errors (use error UI instead)
try {
  await doSomething();
} catch (e) {
  confirm.push("Error occurred"); // NO! Use error banner
}

// =============================================================================
// ACCEPTANCE CRITERIA
// =============================================================================

/**
 * Before merging, verify:
 * 
 * [ ] No spinners during idle states
 * [ ] No red unless truly blocked
 * [ ] Confirmations auto-dismiss in 2.5s
 * [ ] Ledger snippets are read-only
 * [ ] No new buttons added
 * [ ] No new API calls required
 * [ ] Triggers only on real state changes
 * [ ] Never triggers on page load
 */
