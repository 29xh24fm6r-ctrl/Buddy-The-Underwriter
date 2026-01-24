# Layout Audit - Stitch Platform Restoration

## Stitch Surface Registry

| Key | Route | Slug | Mode | Status |
|-----|-------|------|------|--------|
| deal_command | /deals/[dealId]/command | command-center-latest | panel | ACTIVE |
| underwrite | /deals/[dealId]/underwrite | underwrite | iframe | ACTIVE |
| credit_committee | /deals/[dealId]/committee | deal-summary | iframe | ACTIVE |
| borrower_portal | /borrower/portal | borrower-document-upload-review | iframe | ACTIVE |
| portfolio | /portfolio | portfolio-command-bridge | iframe | ACTIVE |
| deal_intake | /intake | deal-intake-console | iframe | ACTIVE |

## Route Audit

| Route | Current Component | Stitch Export? | Status | Notes |
|-------|------------------|----------------|--------|-------|
| /home | CommandBridgeShell | No | OK | Custom shell, already glass-styled |
| /deals | DealsPage | No | OK | Uses GlassCard, dark bg, good styling |
| /deals/new | NewDealPage | No | NEEDS_GLASSHELL | Check styling |
| /deals/[dealId] | redirect | No | OK | Redirects to cockpit |
| /deals/[dealId]/cockpit | DealCockpitClient | No | OK | Already has glass panels |
| /deals/[dealId]/command | StitchPanel | Yes | OK | Uses Stitch |
| /deals/[dealId]/underwrite | StitchSurface | Yes | OK | Uses Stitch |
| /deals/[dealId]/committee | StitchSurface | Yes | OK | Uses Stitch |
| /deals/[dealId]/documents | DocumentsPage | No | NEEDS_GLASSHELL | Legacy styling |
| /deals/[dealId]/pricing | PricingPage | No | NEEDS_GLASSHELL | Check styling |
| /documents | DocumentsPage | No | NEEDS_GLASSHELL | Dark bg but legacy cards |
| /portfolio | PortfolioPage | Yes | BROKEN | Mixed: light native content + Stitch |
| /intake | StitchSurface | Yes | OK | Uses Stitch |
| /borrower/portal | StitchSurface | Yes | OK | Uses Stitch |
| /servicing | ServicingPage | No | NEEDS_GLASSHELL | Dark bg but legacy table |
| /credit-memo | CreditMemoPage | No | NEEDS_GLASSHELL | Dark bg but legacy table |
| /admin | AdminPage | No | NEEDS_GLASSHELL | Light theme, needs dark glass |
| /admin/* | Various | No | NEEDS_GLASSHELL | Light theme pages |
| /analytics | AnalyticsPage | No | NEEDS_GLASSHELL | Check styling |
| /exceptions | ExceptionsPage | No | NEEDS_GLASSHELL | Check styling |
| /risk | RiskPage | No | NEEDS_GLASSHELL | Check styling |
| /governance | GovernancePage | No | NEEDS_GLASSHELL | Check styling |
| /workout | WorkoutPage | No | NEEDS_GLASSHELL | Check styling |
| /committee | CommitteePage | No | NEEDS_GLASSHELL | Check styling |
| /recovery | RecoveryPage | No | NEEDS_GLASSHELL | Check styling |

## Layout Types

### OK
Routes that already have consistent dark/glass styling matching the design system.

### NEEDS_GLASSHELL
Routes that need to be wrapped in GlassShell with consistent dark background, glass cards, and typography.

### BROKEN
Routes with mixed/conflicting layouts that need cleanup.

## Priority Order

1. **BROKEN** - Fix immediately (mixed layouts cause visual jarring)
   - /portfolio

2. **High Traffic NEEDS_GLASSHELL** - Core user flows
   - /documents
   - /servicing
   - /credit-memo
   - /admin

3. **Secondary NEEDS_GLASSHELL** - Supporting pages
   - /analytics
   - /exceptions
   - /risk
   - /governance
   - /workout
   - /committee
   - /recovery

## Design Constants

```tsx
// Background
const darkBg = "bg-[#0b0f1a]";
const headerBg = "bg-[#0f172a]";

// Glass Panel
const glassPanel = "rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm shadow-[0_8px_32px_rgba(0,0,0,0.12)]";
const glassHeader = "border-b border-white/10 bg-white/[0.02] px-5 py-3";

// Typography
const pageTitle = "text-3xl font-semibold text-white";
const pageSubtitle = "text-sm text-white/60";
const sectionTitle = "text-xs font-bold uppercase tracking-widest text-white/50";
```

## Implementation Plan

1. Create `GlassShell` layout component
2. Create `GlassPageHeader` component
3. Create `GlassTable` component
4. Apply to each route in priority order
5. Fix /portfolio mixed layout
6. Add layout audit dev tool
