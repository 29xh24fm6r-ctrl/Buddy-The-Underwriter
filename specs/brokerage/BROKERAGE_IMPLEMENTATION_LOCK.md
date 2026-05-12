# Buddy SBA Brokerage — Implementation Lock

Status: LOCKED
Owner: Matt

## Objective

Build Buddy SBA Brokerage as a first-class product line inside the existing Buddy platform.

The brokerage is NOT a separate app.

It is:
- the existing Buddy underwriting platform
- plus a brokerage tenant
- plus borrower intake
- plus lender marketplace mechanics

---

## Tenant Model

Use the existing `banks` table.

Confirmed live schema:
- `banks.bank_kind`
- default = `commercial_bank`

Allowed kinds:
- `commercial_bank`
- `brokerage`

Singleton brokerage tenant:
- name = Buddy Brokerage
- bank_kind = brokerage

All borrower-funnel deals belong to the Buddy Brokerage tenant.

Marketplace lenders remain normal commercial_bank tenants.

---

## Canonical Routes

Borrower:
- `/start`
- `/portal/[token]`

Marketing:
- `/`
- `/for-banks`

Operations:
- `/cockpit`
- `/admin/brokerage/lenders`
- `/admin/brokerage/listings`

Lender:
- `/lender/listings`
- `/lender/claims`
- `/lender/deals/[dealId]`

---

## Borrower Session Security

Rules:
- raw token ONLY in HTTP-only cookie
- DB stores SHA-256 hash only
- no raw session token persistence
- anonymous endpoints rate-limited

Cookie:
- buddy_borrower_session

DB table:
- borrower_session_tokens

---

## Core Brokerage Flow

1. Intake
2. Uploads
3. OCR/extraction
4. Checklist/readiness
5. SBA score
6. Trident preview
7. Package sealing
8. Marketplace listing
9. Lender claim
10. Borrower pick
11. Atomic unlock
12. Closing fee tracking

---

## Marketplace Rules

Preview:
- opens 9am CT next business day

Claim:
- opens following business day
- first 3 lenders win slots

Borrower:
- sees lender options only after claim window
- picks lender

Winning lender:
- receives full E-Tran-ready package

Borrower:
- receives unlocked trident deliverables

Losing lenders:
- access revoked

---

## Production Hardening Required Before Live Borrowers

P0:
- fix RLS exposure
- borrower token hardening
- upload retry path
- OCR recovery path
- finalized_at consistency
- readiness lifecycle validation
- operational observability

P1:
- borrower reminders
- memo freeze/review/export
- package sealing
- KFS generation
- failed-job dashboard

P2:
- end-to-end fake borrower testing
- 10-15 complete synthetic deals
- lender claim simulations
- borrower pick simulations

---

## Explicit Non-Goals

DO NOT BUILD YET:
- self-serve lender onboarding
- multiple brokerages
- non-SBA products
- autonomous lender selection
- portfolio monitoring
- annual review systems
- workout systems
- examiner tooling
- Pulse / PEIS systems

---

## Operating Principle

Production reliability > feature expansion.

The launch objective is:
- deterministic borrower intake
- deterministic package generation
- deterministic lender delivery
- human-supervised operations

Not autonomy.
