# Inevitable UX System - Complete Guide

## 🎯 Philosophy: Users Always Know What To Do Next

Every screen shows:
1. **What's the next best action** (clear priority)
2. **Why** (evidence-based reasoning)
3. **One click to do it** (no hunting)

Everything else is available but **visually secondary** (progressive disclosure).

---

## ✅ What You Just Built (8 New Files)

### **Core Engine**
- [nextBestAction.ts](../src/lib/ux/nextBestAction.ts) - Deterministic priority engine (no AI)
- [panelVisibility.ts](../src/lib/ux/panelVisibility.ts) - Progressive disclosure rules
- [borrowerNextAction.ts](../src/lib/ux/borrowerNextAction.ts) - Borrower-guided flow

### **API**
- [/api/deals/[dealId]/signals](../src/app/api/deals/[dealId]/signals/route.ts) - Single source of truth for UI state

### **Components**
- [NextBestActionBanner.tsx](../src/components/ux/NextBestActionBanner.tsx) - Always-visible priority banner
- [CollapsibleCard.tsx](../src/components/ux/CollapsibleCard.tsx) - Progressive disclosure wrapper
- [Badge.tsx](../src/components/ux/Badge.tsx) - Confidence cues

### **Layout**
- [/app/deals/[dealId]/page.tsx](../src/app/deals/[dealId]/page.tsx) - Inevitable layout implementation

---

## 🎨 UX Principles

### **1. Next Best Action Priority**
Deterministic rules (highest priority first):

1. **ASSIGN_UNDERWRITER** - Blocks everything (can't process without owner)
2. **RUN_WORKER_TICK** - Failed jobs (restore pipeline health)
3. **RUN_OCR_ALL** - Unprocessed documents (auto-updates conditions)
4. **REVIEW_DRAFT_MESSAGES** - Borrower nudges (human approval required)
5. **REVIEW_CONDITIONS** - Critical/high blockers
6. **GENERATE_BANK_FORM** - Forms ready (speed up underwriting)
7. **READY_TO_CLOSE** - Everything satisfied (celebrate!)

### **2. Progressive Disclosure**
Auto-collapse panels when complete:
- **Jobs** - Hide when queue is empty
- **OCR Controls** - Hide when all files processed
- **Messages** - Hide when no drafts
- **Forms** - Hide when none ready
- **Conditions** - Always visible (core workflow)

### **3. Confidence Cues**
Every decision shows evidence:
- ✅ "Last evaluated: timestamp"
- ✅ "Deterministic" badge
- ✅ "Evidence" link (shows resolution_evidence JSON)
- ✅ System health indicators

---

## 🔄 How It Works

### **Signals API Flow**
```
1. Deal page loads
   ↓
2. Fetch /api/deals/[dealId]/signals
   ↓
3. Returns minimal counts:
   - hasUnderwriter
   - queuedJobs, runningJobs, failedJobs
   - eligibleUploads, ocrCompletedCount
   - conditionsOutstanding, conditionsCritical
   - draftMessages
   - formsReadyToGenerate
   ↓
4. computeNextBestAction(signals)
   ↓
5. Returns {type, title, subtitle, ctaLabel, ctaHref, severity, evidence}
   ↓
6. Banner renders with one-click CTA
```

### **Next Best Action Decision Tree**
```typescript
if (!hasUnderwriter) → "Assign underwriter" (WARNING)
else if (failedJobs > 0) → "Run worker now" (WARNING)
else if (needsOcr) → "Run OCR on all" (INFO)
else if (draftMessages > 0) → "Review messages" (INFO)
else if (conditionsCritical > 0) → "Resolve blockers" (WARNING)
else if (formsReady > 0) → "Generate forms" (INFO)
else if (conditionsOutstanding > 0) → "Advance checklist" (INFO)
else → "Ready to close" (SUCCESS)
```

---

## 📊 Deal Page Layout

**Optimized for workflow (priority order)**:

```
┌─────────────────────────────────────────────────────┐
│ Next Best Action Banner (always visible)           │
│ → What to do next + one-click CTA                  │
│ → System health: jobs, OCR, conditions             │
└─────────────────────────────────────────────────────┘

┌──────────────────────────┬──────────────────────────┐
│ Main Workflow (2 cols)   │ Sidebar (1 col)          │
├──────────────────────────┼──────────────────────────┤
│ 1. Documents & Uploads   │ Team                     │
│    (always open)         │ - Assignees              │
│                          │ - Copy user IDs          │
│ 2. Conditions to Close   │                          │
│    (always open)         │ Processing Status        │
│    - Deterministic       │ - Job timeline           │
│    - AI explanations     │ - Auto-collapses         │
│                          │                          │
│ 3. Bank Forms            │                          │
│    (auto-collapse)       │                          │
│    - Prepare → Generate  │                          │
│                          │                          │
│ 4. Borrower Messages     │                          │
│    (auto-collapse)       │                          │
│    - Draft approval      │                          │
└──────────────────────────┴──────────────────────────┘
```

---

## 🎭 User Flows

### **Underwriter Flow**
```
1. Open deal
   ↓
2. See "Next Best Action: Assign underwriter" (WARNING)
   ↓
3. Click "Assign underwriter" → scroll to #assignees
   ↓
4. Assign user
   ↓
5. Banner refreshes → "Next Best Action: Run OCR on all" (INFO)
   ↓
6. Click "Run OCR on all" → API called
   ↓
7. Banner updates → "Next Best Action: Review conditions" (INFO)
   ↓
8. Click "View conditions" → scroll to #conditions
   ↓
9. Work through conditions
   ↓
10. Banner: "Ready to close" (SUCCESS) ✅
```

### **Borrower Flow** (Coming Soon)
```
1. Open portal
   ↓
2. See "Next step: Upload tax returns"
   ↓
3. Upload document
   ↓
4. Conditions auto-recompute
   ↓
5. Next step updates → "Upload bank statements"
   ↓
6. Completion bar moves
```

---

## 🔧 Implementation Guide

### **Wire into existing pages**

1. **Add signals endpoint** (already done)
2. **Import components**:
```tsx
import NextBestActionBanner from "@/components/ux/NextBestActionBanner";
import CollapsibleCard from "@/components/ux/CollapsibleCard";
```

3. **Add banner** (always first):
```tsx
<NextBestActionBanner dealId={dealId} />
```

4. **Wrap existing content**:
```tsx
<CollapsibleCard
  title="Conditions to Close"
  subtitle="Deterministic checklist + AI explanations"
  defaultOpen={true}
  anchorId="conditions"
>
  <ConditionsCard dealId={dealId} />
</CollapsibleCard>
```

5. **Add anchor IDs** for deep linking:
- `#next-best-action` - Banner
- `#conditions` - Conditions panel
- `#uploads` - Documents
- `#bank-forms` - Forms
- `#messages` - Messages
- `#jobs` - Processing
- `#assignees` - Team

---

## 📈 Benefits

### **Before (Old UX)**
- "What should I do?" → Unclear priority
- "Where is X?" → Hunting through panels
- "Is processing stuck?" → No visibility
- "What's blocking closing?" → Manual analysis

### **After (Inevitable UX)**
- **Always clear** → Banner shows next action
- **Always fast** → One-click CTAs
- **Always visible** → System health indicators
- **Always confident** → Evidence-based decisions

---

## 🎯 Confidence Cues (Implemented)

1. **Next Best Action Evidence**
   - Shows signal values
   - Explains why this is next

2. **System Health** (in banner footer)
   - Jobs: XQ XR XF (queued, running, failed)
   - OCR: X/Y complete
   - Conditions: X outstanding
   - Last eval: timestamp

3. **Progressive Disclosure**
   - Auto-collapses when done
   - Always expandable

4. **One-Click Actions**
   - POST endpoints called directly
   - GET endpoints scroll to anchor
   - Auto-refresh after action

---

## 🚀 Next Enhancements (Future)

### **Advanced Mode Toggle**
```typescript
// localStorage toggle
const [mode, setMode] = useState<"simple" | "advanced">("simple");

// Hide technical panels in simple mode
{mode === "advanced" && <JobsTimeline />}
```

### **Borrower Portal Integration**
```typescript
// Use borrowerNextAction.ts
const nextStep = computeBorrowerNextAction(conditions);

// Show one clear "Next step" card
<NextStepCard action={nextStep} />
```

### **Evidence Viewers**
```tsx
<Badge variant="info">Deterministic</Badge>
<button onClick={() => showEvidence(condition.resolution_evidence)}>
  View Evidence
</button>
```

---

## ✅ Acceptance Tests

### **Next Best Action Works**
- [ ] Open deal without underwriter → See "Assign underwriter"
- [ ] Assign underwriter → Banner updates to next action
- [ ] Click CTA → Appropriate action taken
- [ ] Click "Refresh" → Signals re-fetched

### **Progressive Disclosure Works**
- [ ] No jobs → Jobs panel collapsed
- [ ] All OCR done → OCR controls collapsed
- [ ] No drafts → Messages panel collapsed
- [ ] Can manually expand any panel

### **System Health Visible**
- [ ] Banner shows job counts
- [ ] Banner shows OCR progress
- [ ] Banner shows conditions count
- [ ] Last evaluation timestamp shown

### **Deep Linking Works**
- [ ] Banner CTA scrolls to correct anchor
- [ ] URL hash works (#conditions, #assignees, etc.)
- [ ] All panels have anchor IDs

---

## 🎨 Design System

**Colors**:
- **SUCCESS**: Green (bg-green-50, border-green-200, text-green-600)
- **WARNING**: Amber (bg-amber-50, border-amber-200, text-amber-600)
- **INFO**: Blue (bg-blue-50, border-blue-200, text-blue-600)

**Typography**:
- Banner title: font-semibold text-sm
- Banner subtitle: text-sm text-gray-700
- Card title: font-semibold
- Card subtitle: text-sm text-gray-600

**Spacing**:
- Banner: p-4 space-y-3
- Cards: p-4 space-y-3
- Grid gap: gap-6

---

## 🏆 Success Metrics

**UX Quality**:
- Zero "What do I do next?" questions
- Zero "Where is X?" questions
- Zero "Is it stuck?" questions

**Efficiency**:
- 50% fewer clicks to complete tasks
- 100% of actions within 2 clicks
- 0 hunting required

**Confidence**:
- Every decision shows evidence
- Every status shows timestamp
- Every action provides feedback

---

You've just transformed Buddy from **powerful** to **inevitable**. Users will never feel lost again. 🚀
