# Brokerage Borrower Experience Audit

## Scope
- Phase 15A foundation audit for borrower-facing SBA brokerage surfaces.
- Goal: shift the borrower experience from a utility-style upload console to a guided SBA concierge workflow.
- Guardrails: no backend workflow changes, no auth/token changes, no upload pipeline changes, no storage/security regressions.

## Current Borrower Journey Inventory
1. Borrower lands on [`/start`](../src/app/(borrower)/start/page.tsx) and begins with chat or voice concierge.
2. Concierge session progresses into borrower package creation via [`StartConciergeClient`](../src/app/(borrower)/start/StartConciergeClient.tsx).
3. Borrower receives a private portal link and lands on [`/portal/[token]`](../src/app/(borrower)/portal/[token]/page.tsx).
4. Portal loads borrower context through `portal_get_context`, uploads through `portal_list_uploads`, checklist data through `/api/portal/[token]/checklist`, and status through `/api/portal/[token]/status`.
5. Borrower reviews uploaded files, confirms highlighted values, submits documents, and optionally generates Trident previews.

## Screens And Components Audited
- `/start`
- `/portal/[token]`
- [`PortalClient`](../src/components/borrower/PortalClient.tsx)
- [`PortalShell`](../src/components/borrower/PortalShell.tsx)
- [`BorrowerMagicStatus`](../src/components/borrower/BorrowerMagicStatus.tsx)
- [`BorrowerNextUploadCard`](../src/components/borrower/BorrowerNextUploadCard.tsx)
- [`TridentPreviewCard`](../src/components/borrower/TridentPreviewCard.tsx)
- [`DocToolbar`](../src/components/borrower/DocToolbar.tsx)
- Upload entry points linking to `/upload/[token]`
- Checklist and status APIs:
  - [`/api/portal/[token]/status`](../src/app/api/portal/[token]/status/route.ts)
  - [`/api/portal/[token]/checklist`](../src/app/api/portal/[token]/checklist/route.ts)
  - [`/api/portal/[token]/docs/[uploadId]/field-confirm`](../src/app/api/portal/[token]/docs/[uploadId]/field-confirm/route.ts)

## Borrower Surface Inventory
- `/start`: concierge landing, chat/voice toggle, stage strip, seal package card.
- `/portal/[token]`: token-auth borrower portal shell.
- Upload cards:
  - `BorrowerNextUploadCard`
  - “Upload New Document” card inside `PortalClient`
  - `/upload/[token]` link handoff
- Checklist components:
  - inline requested-documents card inside `PortalClient`
  - `/api/portal/[token]/checklist` data model
- Trident preview surfaces:
  - `TridentPreviewCard`
  - portal preview/download routes
- Borrower status/progress cards:
  - `BorrowerMagicStatus`
  - `BorrowerNextUploadCard`
  - `/api/portal/[token]/status`
- Lender-choice surfaces if present:
  - `/start` copy references matched lenders and neutral selection
  - seal package / lender-claim surfaces remain downstream, not redesigned in Phase 15A

## UX Pain Points
- Portal reads like a three-column internal workbench, not a guided borrower experience.
- Primary next action is fragmented across multiple cards instead of being obvious.
- Document review language centers on extracted data mechanics, not borrower reassurance.
- Placeholder upload and preview actions interrupt trust.
- Success/error feedback is inconsistent across portal actions.
- Start page frames value prop clearly, but the visual system is thinner and less premium than the portal redesign goal.

## Mobile Pain Points
- Three-column portal shell collapses awkwardly and competes for attention on smaller screens.
- Buttons and cards are not consistently touch-first.
- Dense document and checklist groupings create long scanning paths on mobile.
- Status, progress, and next action are separated instead of stacked in a guided order.

## Borrower Jargon / Internal Wording To Remove
- “Buddy Portal”
- “Review extracted data”
- “What We Read”
- “Drop files here”
- “Processing”
- “Checklist”
- “field confirm”
- “Portal error”
- “signed URL”
- “upload flow wired separately”
- internal lender-review phrasing that sounds like staff tooling rather than borrower guidance

## Visual Inconsistencies
- `/start` uses cool blue marketing styling while `/portal/[token]` uses dark, dashboard-like surfaces.
- Portal mixes neutral admin styling with bright blue action cards and placeholder panels.
- Component border radius, spacing, and elevation vary noticeably card to card.
- Empty/loading/error states do not share a common visual system.

## Trust / Anxiety Observations
- Raw technical or route-oriented phrasing can make borrowers question whether the portal is complete or secure.
- Placeholder preview/upload copy weakens confidence in a high-stakes SBA workflow.
- Lack of a single “you are here / next step” frame increases uncertainty.
- Review states should reassure borrowers that documents were received safely and that Buddy is guiding the package forward.

## Primary Next Action Gaps
- Current portal has multiple competing calls to action: apply, upload, review, refresh, preview.
- Missing-doc urgency is present, but not elevated into a single dominant borrower-safe action.
- Review-confirm-submit flow exists, but its importance is visually buried under sidebars and status widgets.

## Before / After Design Principles
### Before
- Functional upload utility
- Internal dashboard composition
- Technical copy
- Mixed visual language
- Multiple competing action zones
- Errors surfaced too literally

### After
- Guided SBA concierge workflow
- Warm, premium, mobile-first shell
- Reassuring borrower-safe copy
- One clear next action at a time
- Progress framed around package completion, not backend mechanics
- Safe errors, secure-language trust cues, and no storage/provider leakage
