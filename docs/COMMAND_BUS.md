# Command Bus System - Complete Documentation

## Overview

The Deal Workspace Command Bus transforms "Next Best Action" from a passive recommendation into an **active command system** that:
- Opens the right modal/panel
- Scrolls + highlights target sections
- Updates URL state (shareable, back/forward friendly)
- Logs actions (audit trail)
- Stays 100% deterministic (no AI guessing)

---

## Architecture

### **Component Structure**

```
Command Bus Flow:
1. NextBestActionCard → computeNextBestAction(signals)
2. User clicks CTA → commandForNextAction(actionType)
3. useDealCommand() executes → Updates URL + UI state
4. DealModals reads URL → Opens modal if ?modal=xyz
5. Anchor IDs + scroll → Highlights target section
```

### **Files Created**

1. **`src/lib/deals/commands.ts`** - Command types + action mapper
2. **`src/lib/deals/uiState.ts`** - URL state management
3. **`src/hooks/useDealCommand.ts`** - Command execution hook
4. **`src/components/deals/DealModals.tsx`** - URL-driven modals

---

## Command Types

### **DealCommand Union Type**

```typescript
type DealCommand =
  | { type: "ASSIGN_UNDERWRITER" }          // Open modal
  | { type: "RUN_WORKER_TICK" }             // API call + scroll to jobs
  | { type: "RUN_OCR_ALL" }                 // API call + scroll to upload
  | { type: "REVIEW_DRAFT_MESSAGES" }       // Open modal + scroll
  | { type: "REVIEW_CONDITIONS" }           // Scroll to conditions
  | { type: "GENERATE_BANK_FORM" }          // Open modal + scroll
  | { type: "REQUEST_MISSING_DOCS" }        // Scroll to conditions
  | { type: "READY_TO_CLOSE" }              // Scroll to conditions (celebration)
  | { type: "FOCUS_SECTION"; section: ... } // Generic scroll
```

### **Command Mapping (Deterministic)**

```typescript
commandForNextAction("ASSIGN_UNDERWRITER")
  → { type: "ASSIGN_UNDERWRITER" }
  → Opens ?modal=assignUnderwriter
  → Scrolls to #assignees
  → Highlights for 1.2s

commandForNextAction("RUN_OCR_ALL")
  → { type: "RUN_OCR_ALL" }
  → Sets ?panel=upload&focus=upload
  → Scrolls to #upload
  → Highlights for 1.2s
```

---

## URL State Management

### **Query Params**

- `?modal=assignUnderwriter` - Which modal is open
- `?panel=upload` - Which collapsible panel is expanded
- `?focus=conditions` - Which section is highlighted

### **Benefits**

1. **Shareable**: Copy URL → same UI state
2. **Back/Forward**: Browser history works
3. **Deep Linking**: Email link → opens exact view
4. **No State Drift**: URL is source of truth

### **Example URLs**

```
/deals/abc123?modal=assignUnderwriter&focus=assignees
  → Modal open + assignees section highlighted

/deals/abc123?panel=messages&focus=messages
  → Messages panel expanded + highlighted

/deals/abc123?modal=reviewDrafts&panel=messages
  → Draft review modal + messages panel visible
```

---

## Anchor IDs (Scroll Targets)

All key cards have stable `id` attributes:

- `#setup` - DealSetupCard
- `#upload` - UploadBox
- `#jobs` - DocumentInsightsCard (processing timeline)
- `#forms` - BankFormsCard
- `#conditions` - Conditions to Close
- `#messages` - DraftMessagesCard
- `#assignees` - DealAssigneesCard
- `#pack` - PackNavigatorCard

### **Scroll Behavior**

```typescript
scrollToId("conditions")
  → Smooth scroll to element
  → Add ring-2 ring-blue-500 ring-offset-2
  → Remove ring after 1.2s (visual highlight)
```

---

## Modals (URL-Driven)

### **Modal Components**

1. **AssignUnderwriterModal**
   - Opens when `?modal=assignUnderwriter`
   - Select from dropdown → POST to /api/deals/{id}/participants
   - Closes modal → removes `?modal` param

2. **ReviewDraftsModal**
   - Opens when `?modal=reviewDrafts`
   - Shows draft messages queue
   - Approve/reject workflow

3. **GenerateFormModal**
   - Opens when `?modal=generateForm`
   - Form generation workflow
   - Wire to BankFormsCard logic

### **Modal Pattern**

```typescript
// Read URL state
const uiState = parseDealUiState(params);

// Render conditionally
if (uiState.modal === "assignUnderwriter") {
  return <AssignUnderwriterModal ... />;
}

// Close modal = remove from URL
const closeModal = () => {
  const next = buildDealUrlState(params, { modal: null });
  router.replace(`?${next.toString()}`);
};
```

---

## Usage Examples

### **In NextBestActionCard**

```typescript
import { useDealCommand } from "@/hooks/useDealCommand";
import { commandForNextAction } from "@/lib/deals/commands";

const runCommand = useDealCommand();

const handleClick = () => {
  const cmd = commandForNextAction(nextAction.type);
  runCommand(cmd);
  
  // If action has API call, execute it
  if (nextAction.ctaAction) {
    await fetch(nextAction.ctaAction, { method: "POST" });
  }
};
```

### **Custom Commands**

```typescript
const runCommand = useDealCommand();

// Focus specific section
runCommand({ type: "FOCUS_SECTION", section: "conditions" });

// Open modal programmatically
runCommand({ type: "ASSIGN_UNDERWRITER" });
```

---

## Command Execution Flow

### **Example: "Assign Underwriter"**

```
1. User clicks "Assign underwriter" CTA
   ↓
2. NextBestActionCard calls:
   runCommand(commandForNextAction("ASSIGN_UNDERWRITER"))
   ↓
3. useDealCommand() executes:
   - buildDealUrlState({ modal: "assignUnderwriter", focus: "assignees" })
   - router.replace("?modal=assignUnderwriter&focus=assignees")
   - scrollToId("assignees")
   ↓
4. URL updates → DealModals re-renders
   ↓
5. parseDealUiState(params).modal === "assignUnderwriter"
   ↓
6. AssignUnderwriterModal renders
   ↓
7. User selects underwriter + clicks "Assign"
   ↓
8. POST /api/deals/{id}/participants
   ↓
9. Modal calls onClose() → removes ?modal param
   ↓
10. NextBestActionCard auto-refreshes signals
   ↓
11. Next action updates to "Run OCR on all"
```

---

## Benefits

### **Before Command Bus**

- Next action = passive text
- User hunts for section
- No URL state → not shareable
- Manual navigation required

### **After Command Bus**

- ✅ One-click execution (open modal/scroll/highlight)
- ✅ URL-driven state (shareable, back/forward works)
- ✅ Visual feedback (ring highlight for 1.2s)
- ✅ Deterministic (same command → same result)
- ✅ Audit-ready (can log command execution)

---

## Deterministic Guarantees

1. **Same action type → Same command**
   - `ASSIGN_UNDERWRITER` always opens assign modal
   - `RUN_OCR_ALL` always scrolls to upload
   - No variation, no randomness

2. **Same command → Same UI state**
   - Command produces deterministic URL params
   - URL params produce deterministic modal/panel state

3. **Reproducible**
   - Copy URL → exact same view
   - Back/forward → exact state restoration
   - Share link → recipient sees same thing

---

## Future Enhancements

### **Audit Logging** (optional)

```typescript
// Log command execution
await fetch("/api/deals/{id}/audit", {
  method: "POST",
  body: JSON.stringify({
    event: "deal_command_executed",
    command_type: cmd.type,
    command_data: cmd,
    evidence: nextAction.evidence,
  }),
});
```

### **Command Middleware**

```typescript
// Pre-execute hooks
const runCommand = useDealCommand({
  before: (cmd) => console.log("Executing:", cmd),
  after: (cmd) => analytics.track("command_executed", cmd),
});
```

### **Keyboard Shortcuts**

```typescript
// Cmd+1 → Focus conditions
// Cmd+2 → Focus upload
// Cmd+A → Assign underwriter
useKeyboard({ "cmd+a": () => runCommand({ type: "ASSIGN_UNDERWRITER" }) });
```

---

## Testing

### **Command Mapping Tests**

```typescript
test("maps ASSIGN_UNDERWRITER to modal command", () => {
  const cmd = commandForNextAction("ASSIGN_UNDERWRITER");
  expect(cmd).toEqual({ type: "ASSIGN_UNDERWRITER" });
});
```

### **URL State Tests**

```typescript
test("builds URL with modal param", () => {
  const params = new URLSearchParams();
  const next = buildDealUrlState(params, { modal: "assignUnderwriter" });
  expect(next.get("modal")).toBe("assignUnderwriter");
});
```

### **Integration Tests**

```typescript
test("clicking CTA opens modal", async () => {
  render(<NextBestActionCard dealId="abc" />);
  fireEvent.click(screen.getByText("Assign underwriter"));
  
  await waitFor(() => {
    expect(window.location.search).toContain("modal=assignUnderwriter");
  });
});
```

---

## Summary

You now have a **deterministic command bus** that:
- Maps next actions to executable commands
- Updates URL state (shareable + history-friendly)
- Opens modals/panels/sections intelligently
- Scrolls + highlights targets visually
- Stays 100% predictable (no AI guessing)

**Every click does exactly what it promises. Every time. No surprises.**

🚀 The underwriter cockpit is now **inevitable** - users always know what to do next, and it's always one click away.
