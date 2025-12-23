# Buddy The Underwriter — Canonical Screen Flow

## 0) Entry
- Login / Auth
- Deals List (home)

## 1) Deal Command Center (deal-level hub)
Purpose: everything about the deal in one place.
- Snapshot status (docs, conditions, risks)
- Latest AI intel
- Key actions: Run Intel, Generate Memo, Quote Pricing

Next:
- Borrower Portal
- Uploads / Documents
- Underwrite
- Pricing
- Credit Memo

## 2) Borrower Portal
Purpose: borrower uploads + requests + communication.
- Document requests
- Upload inbox
- Auto-matching + status
- Messages

Next:
- Documents (internal view)
- Underwrite

## 3) Documents (Internal)
Purpose: staff-side document library & evidence.
- All uploads, classifications, OCR status
- Viewer + extracted data
- Evidence trails

Next:
- Underwrite
- Credit Memo

## 4) Underwrite (AI + human)
Purpose: turn documents into risk facts.
- Financial spreads (IS/BS/CF)
- Bank fee / product burden
- Risks, mitigants, conditions

Next:
- Pricing
- Credit Memo

## 5) Pricing (Risk-Based)
Purpose: convert risk facts to structure + rate.
- Pricing quote
- Overrides + approvals
- Final terms

Next:
- Credit Memo

## 6) Credit Memo Generator
Purpose: produce the artifact that gets approved/sent.
- AI memo draft
- Evidence citations
- Export PDF / share

Next:
- Submission / package / close

## 7) Post-close / Servicing
Purpose: manage covenants, monitoring, exceptions.

---

## Navigation Groups

### Acquire
- Deals (list/hub)
- Borrower Portal (borrower-facing)
- Documents (staff-facing library)

### Decide
- Underwrite (risk analysis)
- Pricing (structure + rate)
- Credit Memo (approval artifact)

### Operate
- Servicing (post-close)
- Admin (configuration)

---

## Key Transitions

```
Entry → Deals List
       ↓
Deal Command Center (hub)
       ↓
    ┌──┴──┬─────┬─────┬────────┐
    ↓     ↓     ↓     ↓        ↓
Borrower Documents Under- Pricing Memo
Portal          write
    ↓           ↓      ↓        ↓
    └───────→ Underwrite → Pricing → Memo → Close
```

---

## Implementation Checklist

- [x] Global HeroBar component
- [x] Canonical flow document
- [ ] Deal Command Center (hub screen)
- [ ] Intel panel (on hub)
- [ ] Pricing panel (on hub)
- [ ] Navigation groups in HeroBar
- [ ] Breadcrumb trail
- [ ] Flow-aware "Next Step" button
