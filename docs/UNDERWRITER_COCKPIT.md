# Underwriter Cockpit - 3-Column Layout

## Overview

The Deal Workspace is now organized as a **3-column "Underwriter Cockpit"** that mirrors the mental model of institutional underwriters:

**Left → Center → Right = Identity → Work → Command**

---

## Layout Structure

### **Left Rail - Deal Identity & Navigation**

**Purpose:** Stable orientation - who/what/where is this deal

Components:
1. **DealHeaderCard**
   - Borrower name & entity type
   - Deal status & last activity
   - Risk rating (placeholder)
   - Copy deal ID

2. **DealSetupCard**
   - Loan type selector (SBA 7(a), 504, CRE, LOC, Term)
   - Future: Loan amount, terms, collateral type

3. **PackNavigatorCard**
   - Document pack organization
   - Processing queue toggle
   - Job status indicators (queued/running/failed)

---

### **Center - Work Surface**

**Purpose:** Where underwriters spend time - upload, analyze, generate

Components:
1. **UploadBox**
   - Bulk document upload
   - Drag & drop interface
   - OCR launch

2. **DocumentInsightsCard**
   - Latest OCR results
   - Extracted text previews
   - Tables extracted indicators
   - Confidence scores
   - Future: AI key findings

3. **BankFormsCard**
   - Template selection
   - Prepare → Review → Generate workflow
   - Download filled PDFs

---

### **Right Rail - Command Center**

**Purpose:** Decision-making & communications - what's next, what's blocking

Components:
1. **NextBestActionCard** ⭐
   - **Single focused action** (deterministic priority)
   - **Evidence chips** (why this is next)
   - **"Because:" section** (hard facts, no AI guessing)
   - **"Why this is next:" bullets** (context for action)
   - **One-click CTA** (execute action)
   - **Evidence detail** (expandable full context)

2. **Conditions to Close**
   - Grouped checklist (borrower/guarantor/business/closing)
   - Deterministic + AI explanations
   - Severity indicators
   - Future: Full conditions card integration

3. **DraftMessagesCard**
   - Pending drafts (approval queue)
   - Approved messages (queued to send)
   - Sent messages log
   - One-click approve & send

4. **DealAssigneesCard**
   - Team participants
   - Underwriter ownership
   - Copy user IDs

---

## Next Best Action Priority

The **NextBestActionCard** uses deterministic rules (no AI guessing):

### Priority Order:
1. **ASSIGN_UNDERWRITER** (WARNING)
   - Blocks everything
   - Evidence: "No underwriter assigned"
   - Why: "Ownership unlocks SLA tracking + queue routing"

2. **RUN_WORKER_TICK** (WARNING)
   - Failed jobs exist
   - Evidence: "X failed jobs"
   - Why: "Failed jobs block pipeline health"

3. **RUN_OCR_ALL** (INFO)
   - Unprocessed documents
   - Evidence: "X files not OCR'd"
   - Why: "This will auto-sort docs + update conditions"

4. **REVIEW_DRAFT_MESSAGES** (INFO)
   - Draft messages pending
   - Evidence: "X draft messages pending"
   - Why: "Approving sends + logs activity to borrower"

5. **REVIEW_CONDITIONS** (WARNING)
   - Critical/high conditions outstanding
   - Evidence: "X critical conditions", "X high-priority conditions"
   - Why: "Critical/high conditions block closing"

6. **GENERATE_BANK_FORM** (INFO)
   - Forms ready to generate
   - Evidence: "X forms ready"
   - Why: "Forms ready speed up underwriting"

7. **READY_TO_CLOSE** (SUCCESS)
   - All conditions satisfied
   - Evidence: "0 conditions outstanding"
   - Why: "All conditions satisfied!"

---

## Evidence System

### Three Levels of Evidence:

1. **Evidence Chips** (top-level facts)
   - Visual badges showing state
   - Examples: "No underwriter assigned", "3 files not OCR'd", "2 draft messages pending"

2. **"Because:" Section** (immediate context)
   - Why this action is recommended
   - Derived from evidence chips
   - No AI speculation

3. **"Why this is next:" Bullets** (strategic context)
   - Business reasoning
   - Impact explanation
   - Deterministic, not AI-generated

4. **Evidence Detail** (expandable)
   - Full signal values
   - Complete state snapshot
   - For power users who want raw data

---

## Deterministic vs AI

**NextBestActionCard is 100% deterministic:**
- ✅ Rules decide priority
- ✅ Evidence proves decision
- ✅ No hallucination risk
- ✅ Exam-proof logic
- ✅ Badge shows "Deterministic"

**AI is separate and labeled:**
- AI explanations in conditions (clearly marked)
- AI insights in documents (coming soon, clearly marked)
- AI never decides priority
- Human always approves AI suggestions

---

## User Flows

### **Typical Underwriter Session:**

1. **Open deal**
   → See NextBestActionCard: "Assign underwriter" (WARNING)
   
2. **Click "Assign underwriter"**
   → Scrolls to #assignees
   → Assign user
   
3. **NextBestActionCard auto-refreshes**
   → Now shows: "Run OCR on all" (INFO)
   → Evidence: "5 files not OCR'd"
   
4. **Click "Run OCR on all"**
   → POST to /api/deals/{dealId}/uploads/ocr-all
   → Jobs queued
   → NextBestActionCard refreshes
   
5. **NextBestActionCard updates**
   → Now shows: "Review conditions" (INFO)
   → Evidence: "3 conditions outstanding"
   
6. **Click "View conditions"**
   → Scrolls to #conditions
   → Work through conditions
   
7. **NextBestActionCard updates**
   → Shows: "Ready to close" (SUCCESS) ✅

---

## Component Details

### NextBestActionCard.tsx

**Features:**
- Fetches `/api/deals/{dealId}/signals`
- Calls `computeNextBestAction(signals)`
- Color-coded by severity (green/amber/blue)
- One-click CTA execution (POST/GET)
- Auto-refresh after action
- Evidence chips from signals
- Contextual "why" bullets
- Expandable evidence detail

**States:**
- Loading: Skeleton animation
- No data: "No action data available"
- Active: Shows next action with CTA

### DealHeaderCard.tsx

**Features:**
- Deal identity (borrower name, entity type)
- Status & last activity (time ago)
- Copy deal ID (click to copy)
- Risk rating placeholder

### DealSetupCard.tsx

**Features:**
- Loan type radio selector
- 5 types: SBA 7(a), SBA 504, CRE, LOC, Term
- Saves on change (TODO: wire to API)
- Expandable for future config

### PackNavigatorCard.tsx

**Features:**
- Lists document packs
- Processing queue toggle
- Job status badges (queued/running/failed)
- Collapsible job list
- Color-coded by status

### DocumentInsightsCard.tsx

**Features:**
- Latest 5 OCR results
- Extracted text preview (200 chars)
- Confidence scores
- Tables extracted indicator
- Key findings placeholder

### DraftMessagesCard.tsx

**Features:**
- Pending drafts (approval required)
- Approved messages (queued to send)
- Sent messages log (collapsible)
- One-click approve & send
- Empty state guidance

---

## Next Enhancements

### Phase 1 - Wire Missing APIs:
1. Create `/api/deals/{dealId}/ocr/results` endpoint
2. Create `/api/deals/{dealId}/messages` endpoint
3. Create `/api/deals/{dealId}/messages/{id}/approve` endpoint
4. Wire DealSetupCard to persist loan type

### Phase 2 - Conditions Integration:
1. Create ConditionsToCloseCard component
2. Wire to existing conditions data
3. Show evidence viewer modal
4. Add "View Evidence" links

### Phase 3 - Advanced Mode:
1. Add localStorage toggle (simple/advanced)
2. Hide technical panels in simple mode
3. Show raw JSON in advanced mode
4. Add system diagnostics panel

### Phase 4 - Real-time Updates:
1. Add SSE/websocket for live job updates
2. Auto-refresh NextBestActionCard on job completion
3. Toast notifications for state changes
4. Optimistic UI updates

---

## Design Principles

### **1. Left to Right Flow**
- Identity → Work → Command
- Stable → Active → Decisive
- Context → Action → Decision

### **2. Evidence-Based Decisions**
- Every action shows "why"
- Facts not speculation
- Deterministic priority
- Human always in control

### **3. Progressive Disclosure**
- Critical items always visible
- Secondary items collapsible
- Advanced features tucked away
- Power users can expand all

### **4. One Action at a Time**
- NextBestActionCard shows single focus
- Reduces decision paralysis
- Clear priority order
- Natural workflow progression

---

## Success Metrics

**Before (old UX):**
- "What should I do?" → Unclear
- "Where is X?" → Hunting
- "Is it stuck?" → No visibility
- Scattered workflow

**After (Cockpit UX):**
- ✅ Always clear next action
- ✅ One-click execution
- ✅ System health visible
- ✅ Evidence-based confidence
- ✅ Natural left→right flow
- ✅ No hunting required

---

You now have an **institutional-grade underwriter cockpit** that:
1. Guides users with deterministic next actions
2. Provides evidence for every decision
3. Organizes work surface logically
4. Keeps command center always visible
5. Reduces cognitive load
6. Builds confidence through transparency

🚀 **Best LOS in the universe!**
