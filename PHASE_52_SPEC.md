# Phase 52 — Cockpit Redesign
**Status: SPEC — do not build until reviewed**
**Author: Claude (reconciled against live codebase)**
**Target: Antigravity**

---

## The Problem

The cockpit is a dumping ground. Every feature was appended without a design hierarchy. The result:
- Borrower inputs that appear broken (inputs have correct code but wrong visual context)
- 4 panels stacked in the left column (CoreDocuments, ArtifactPipeline, PipelinePanel, DealFilesCard)
- DealHealthPanel and BankerVoicePanel bolted below the cockpit as afterthoughts
- Setup tab contains: intake form + loan requests + borrower entity — three completely different concerns
- No place for the banker to tell the story of the deal — the qualitative context documents cannot provide
- Buddy's research questions (from BIE `underwriting_questions`) are generated but never surfaced

Design target: **clean, tight, purposeful — every element earns its place.**

---

## Design Principles

1. **One primary action at a time.** The cockpit tells the banker what to do next. Not everything at once.
2. **Status at a glance.** Deal health, document status, readiness — visible in one compact strip, not three giant panels.
3. **No raw technical labels in UI.** Not "auto-seed checklist." Not "DSCR confirm." Not "ArtifactPipelinePanel." Real English.
4. **Progressive disclosure.** Details expand when needed, not always visible.
5. **The Story tab is the interview.** This is where qualitative context is collected — via typing, via chat, or via voice. One place. Not scattered.

---

## Layout Architecture

### Before (current)
```
[Hero Header]
[3-column grid: Left(4 panels) | Center(Checklist) | Right(Readiness)]
[Secondary Tabs: Setup | Portal | Underwriting | Spreads | Timeline | Admin]
[DealHealthPanel] ← bolted on below
[BankerVoicePanel] ← bolted on below
```

### After (target)
```
[Hero Header] ← unchanged
[Status Strip] ← NEW: compact single row replacing 3-column grid
[Primary Workspace Tabs] ← replaces Secondary Tabs, now the main content
```

---

## Status Strip

A single compact horizontal strip. Replaces the entire 3-column grid.
Each item is a pill/chip. Clicking it opens an inline dropdown — not a modal, not a new page.

```
[📄 Documents 9/9 ✅] [✓ Checklist 5/5 ✅] [⚡ Pipeline Ready] [🎯 Readiness: Ready for Underwriting] [→ Generate Snapshot]
```

**Document chip** expands to show CoreDocumentsPanel inline.
**Checklist chip** expands to show YearAwareChecklistPanel inline.
**Pipeline chip** expands to show PipelinePanel inline (status only, not admin controls).
**Readiness chip** expands to show ReadinessPanel inline.
**Generate Snapshot / Primary CTA** stays as a button on the right side of the strip.

This collapses the entire left + center + right column into a single scannable row.

**Implementation notes:**
- All four existing panel components stay unchanged internally
- Only their container changes — they render inside a collapsible chip
- Default state: all chips collapsed, showing summary text only
- State persists in localStorage per dealId
- On mobile: chips stack vertically

---

## Primary Workspace Tabs

Replaces `SecondaryTabsPanel`. Five tabs, all at the same level. No nesting.

| Tab | Icon | What it contains |
|-----|------|-----------------|
| **Setup** | `settings` | Loan type, loan request, borrower entity — clean and functional |
| **Story** | `auto_stories` | Buddy's questions + guided qualitative fields + voice/chat interview |
| **Documents** | `folder_open` | DealFilesCard + upload controls (moved from left column) |
| **Underwriting** | `analytics` | AI risk, outputs, spreads link |
| **Timeline** | `timeline` | DealStoryTimeline |

Admin tab remains but is only visible to admins (unchanged behavior).
Portal tab is removed from primary tabs — portal controls move into Setup under a "Borrower Portal" subsection.

Default tab: `story` if story is empty, `setup` if deal is not yet ignited, otherwise `story`.

---

## Tab: Setup

**Goal:** Get the deal configured. One-time work. Clean form.

### Section 1 — Loan Details
- Loan Type selector (existing, unchanged)
- Loan Requests section (existing `LoanRequestsSection` component, unchanged)
- Save button — no "Auto-Seed Checklist" label. Label: **"Save"**. The checklist seeds automatically in the background.

### Section 2 — Borrower
- This replaces both `DealIntakeCard`'s borrower fields AND `BorrowerAttachmentCard`
- Two modes:
  - **New borrower**: Name, email, phone fields. Inputs MUST work — use standard controlled inputs with explicit `text-white` and `bg-neutral-950` classes. This is the current bug.
  - **Existing entity**: Entity search/attach (existing BorrowerAttachmentCard logic)
- Ownership entities shown inline if attached — name, ownership %, title
- "Invite borrower to portal" link — opens a simple modal with name + email, copies portal link when created

### Section 3 — Borrower Portal (collapsed by default)
- Toggle: "Borrower Portal — Off / On"
- When expanded: BorrowerRequestComposerCard + BorrowerUploadLinksCard
- UploadAuditCard hidden here (admin-only, move to Admin tab)

### What is REMOVED from Setup
- AI Doc Recognition button — this moves to the Documents tab where it belongs
- Retry Intake / Admin Override buttons — these move to Admin tab
- Manual Doc Recognition — Admin tab
- matchMessage debug text — stays but styled as a small status line, not a giant preformatted block
- ArtifactPipelinePanel — removed from cockpit entirely (available in Documents tab)

---

## Tab: Story ← NEW

**Goal:** Collect everything documents cannot provide. This is the banker's voice on the deal.

This tab has three sections:

### Section 1 — Buddy's Questions

Populated from:
1. BIE `underwriting_questions` field in `buddy_research_narratives` (already generated, never surfaced)
2. `deal_gap_queue` rows with `gap_type = 'missing_fact'` (genuinely missing facts)

Each question renders as a card:
```
┌─────────────────────────────────────────────────────┐
│ 🔍  Revenue dropped 18% from 2022 to 2023.          │
│     What drove that decline?                         │
│                                                      │
│  [Type your answer...]              [Answer by voice]│
└─────────────────────────────────────────────────────┘
```

- Text area: saves to `deal_memo_overrides` on blur, keyed as `buddy_question_{index}`
- "Answer by voice" button: launches a focused single-question voice session targeting that question specifically
- Questions are ordered: conflicts first, missing facts second, research questions third
- "All answered" state: section collapses and shows a green checkmark
- If no questions yet (BIE hasn't run): show "Run Research to generate Buddy's questions" with a button

### Section 2 — Deal Story

Guided fields that feed directly into the credit memo. Each field:
- Shows a label (plain English, not a DB key)
- Shows a subtle placeholder explaining what's needed and why
- Saves to `deal_memo_overrides` on blur (debounced 800ms)
- Shows a ✓ when populated

```
USE OF PROCEEDS
What exactly will the loan proceeds purchase or fund?
[                                                    ]

MANAGEMENT BACKGROUND  
How long has the principal been in this specific industry? Any prior relevant businesses?
[                                                    ]

COLLATERAL
Address, appraised value, who holds the appraisal, lien position.
[                                                    ]

BANKING RELATIONSHIP
How long has the borrower banked here? Existing deposits, prior loans?
[                                                    ]

DEAL STRENGTHS
What makes this credit compelling? What would you tell the committee?
[                                                    ]

DEAL WEAKNESSES / MITIGANTS
What keeps you up at night on this deal, and how is it mitigated?
[                                                    ]
```

Fields map to `deal_memo_overrides` keys:
- `use_of_proceeds`
- `principal_background`
- `collateral_description` (existing)
- `banking_relationship`
- `key_strengths`
- `key_weaknesses`

Pre-populated fields (already in overrides) display their saved values on load.

### Section 3 — Credit Interview

This replaces the current `BankerVoicePanel` and `TranscriptUploadPanel` entirely.

Two modes, presented as a single integrated widget:

**Voice Interview** (primary)
```
┌────────────────────────────────────────────┐
│  🎙  Start Credit Interview                 │
│  Buddy will ask about this deal based on   │
│  what it knows and what's still missing.   │
│                                            │
│           [Start Interview]                │
└────────────────────────────────────────────┘
```

When active: shows live transcript, confirmed facts as they're recorded, End Session button.

**Transcript Upload** (secondary, collapsed under "Or paste a transcript")
- Same as existing TranscriptUploadPanel

---

## Tab: Documents

**Goal:** Document management. One place for all file operations.

Contains (in order):
1. `DealFilesCard` — file list, upload, auto-match
2. `CoreDocumentsPanel` — required document checklist (moved from left column)
3. AI Doc Recognition button (moved here from Setup)
4. `ArtifactPipelinePanel` — document processing pipeline status

---

## Tab: Underwriting

Unchanged content, cleaner presentation:
1. `RiskDashboardPanel`
2. `UnderwritingControlPanel`
3. `DealOutputsPanel`
4. `PreviewUnderwritePanel`
5. Link to Spreads page (instead of a tab that just navigates away)

---

## Tab: Timeline

Unchanged: `DealStoryTimeline`

---

## What Gets Deleted / Moved

| Component | Current location | New location |
|-----------|-----------------|--------------|
| `DealHealthPanel` | Below cockpit (cockpit/page.tsx) | Removed from cockpit page — lives inside Story tab as a compact status row above Buddy's Questions |
| `BankerVoicePanel` | Below cockpit (cockpit/page.tsx) | Removed from cockpit page — lives inside Story tab Section 3 |
| `TranscriptUploadPanel` | Credit memo page | Removed from credit memo — lives inside Story tab Section 3 |
| `ArtifactPipelinePanel` | Left column | Documents tab |
| `DealFilesCard` | Left column | Documents tab |
| `CoreDocumentsPanel` | Left column | Documents tab |
| `PipelinePanel` | Left column | Status strip chip |
| `YearAwareChecklistPanel` | Center column | Status strip chip |
| `ReadinessPanel` | Right column | Status strip chip |
| `BorrowerRequestComposerCard` | Portal tab | Setup tab, Section 3 (collapsed) |
| `BorrowerUploadLinksCard` | Portal tab | Setup tab, Section 3 (collapsed) |
| Portal tab | Secondary tabs | Removed — content merged into Setup |
| Spreads tab | Secondary tabs | Removed — replaced with link button in Underwriting tab |

---

## The Borrower Input Bug

The current `DealIntakeCard` borrower inputs DO have correct React controlled state. The visual bug (can't type) is caused by CSS — inputs inherit `text-white` but background is `bg-neutral-950` which in some Tailwind configurations renders as transparent, making text invisible against the input background.

**Fix:** Add explicit `text-white bg-neutral-950 placeholder:text-neutral-500` to every `<input>` and `<textarea>` in `DealIntakeCard.tsx`. This is a one-line fix per field, not a rewrite.

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/components/deals/cockpit/StatusStrip.tsx` | New compact status strip replacing 3-column grid |
| `src/components/deals/cockpit/StatusChip.tsx` | Individual expandable chip component |
| `src/components/deals/cockpit/panels/StoryPanel.tsx` | New Story tab — Buddy questions + guided fields + interview |
| `src/components/deals/cockpit/panels/DocumentsTabPanel.tsx` | New Documents tab — consolidates file management |

## Files to Modify

| File | Change |
|------|--------|
| `src/components/deals/DealCockpitClient.tsx` | Replace 3-column grid with `<StatusStrip>`, update secondary tabs section |
| `src/components/deals/cockpit/panels/SecondaryTabsPanel.tsx` | New tab list (Setup/Story/Documents/Underwriting/Timeline), add StoryPanel, remove Portal tab, update Setup tab content |
| `src/components/deals/DealIntakeCard.tsx` | Fix input CSS (text-white, bg-neutral-950, placeholder color). Move AI Doc Recognition button out. Clean up matchMessage display. |
| `src/app/(app)/deals/[dealId]/cockpit/page.tsx` | Remove `<DealHealthPanel>` and `<BankerVoicePanel>` from bottom — they now live in StoryPanel |

## Files Unchanged (just moved/reused)

All existing panel components are reused as-is. This redesign is a container/layout change, not a component rewrite.

---

## Implementation Order for Antigravity

1. Fix the borrower input CSS bug in `DealIntakeCard.tsx` — ship immediately, no other changes
2. Build `StatusChip.tsx` and `StatusStrip.tsx`
3. Replace 3-column grid in `DealCockpitClient.tsx` with `StatusStrip`
4. Build `StoryPanel.tsx` (Section 1: Buddy questions, Section 2: guided fields, Section 3: interview widget)
5. Build `DocumentsTabPanel.tsx`
6. Update `SecondaryTabsPanel.tsx` with new tab list and content
7. Remove `DealHealthPanel` and `BankerVoicePanel` from `cockpit/page.tsx`
8. Clean up Setup tab in `SecondaryTabsPanel.tsx`

---

## API Requirements

No new API routes needed. StoryPanel reads from:
- `GET /api/deals/[dealId]/gap-queue` — already exists (Buddy's questions from missing_fact gaps)
- `buddy_research_narratives` — read via existing research loading pattern
- `deal_memo_overrides` — read/write via existing override API

Voice in StoryPanel uses existing `BankerVoicePanel` logic, just embedded inline.

---

## Success Criteria

1. Banker opens cockpit — sees deal name, a compact status strip, and the Story tab
2. Story tab is the first thing they engage with — questions from Buddy, fields to fill in
3. Inputs in Setup tab work correctly (typing visible)
4. No panel is duplicated or orphaned
5. DealHealthPanel and BankerVoicePanel are gone from the bottom of the cockpit page
6. The cockpit feels like one coherent workspace, not a list of features

---

*This spec was produced by Claude after reading: DealCockpitClient.tsx, SecondaryTabsPanel.tsx, DealIntakeCard.tsx (full), LeftColumn.tsx, RightColumn.tsx, CenterColumn.tsx, cockpit/page.tsx, and the full component directory listing.*
