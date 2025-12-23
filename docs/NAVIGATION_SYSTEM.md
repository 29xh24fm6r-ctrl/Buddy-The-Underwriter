# Global Navigation System ✅

## What's Been Created

### ✅ 1. Global Hero Bar
**Files:**
- [src/components/nav/HeroBar.tsx](../src/components/nav/HeroBar.tsx) - Simple flat navigation
- [src/components/nav/HeroBarGrouped.tsx](../src/components/nav/HeroBarGrouped.tsx) - Grouped by flow phase

**Wired into:** [src/app/layout.tsx](../src/app/layout.tsx)

**Features:**
- Sticky top bar on every page
- Active route highlighting
- Mobile-responsive (horizontal scroll)
- Dark theme with glassmorphism
- Quick access to Command + Settings

### ✅ 2. Canonical Flow Document
**File:** [FLOW.md](FLOW.md)

**Purpose:**
- Single source of truth for screen order
- Navigation logic
- Onboarding sequence
- Demo script
- Build priority

---

## Current Setup

### Active Navigation
Currently using **HeroBar** (flat list) in [src/app/layout.tsx](../src/app/layout.tsx):

```tsx
import { HeroBar } from "@/components/nav/HeroBar";

export default function RootLayout({ children }) {
  return (
    <ClerkProvider>
      <html lang="en" className="dark">
        <body>
          <HeroBar />
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
```

### Navigation Structure

**Current (Flat):**
```
Deals | Borrower Portal | Documents | Underwrite | Pricing | Credit Memo | Servicing | Admin
```

**Alternative (Grouped):**
```
Acquire: Deals | Borrower Portal | Documents
Decide: Underwrite | Pricing | Credit Memo
Operate: Servicing | Admin
```

---

## Upgrade to Grouped Navigation (Optional)

To show the flow more clearly, swap to grouped version:

**In [src/app/layout.tsx](../src/app/layout.tsx):**
```tsx
import { HeroBarGrouped } from "@/components/nav/HeroBarGrouped";

// Change this:
<HeroBar />

// To this:
<HeroBarGrouped />
```

---

## Navigation Routes

### Acquire (Get Information)
| Route | Purpose | Status |
|-------|---------|--------|
| `/deals` | Deal list + hub | ✅ Exists |
| `/borrower-portal` | Borrower-facing upload | ⚠️ Check route |
| `/documents` | Staff document library | ⚠️ Check route |

### Decide (Make Decision)
| Route | Purpose | Status |
|-------|---------|--------|
| `/underwrite` | Risk analysis | ⚠️ Check route |
| `/pricing` | Structure + rate | ⚠️ Check route |
| `/credit-memo` | Approval artifact | ⚠️ Check route |

### Operate (Manage Ongoing)
| Route | Purpose | Status |
|-------|---------|--------|
| `/servicing` | Post-close monitoring | ⚠️ Check route |
| `/admin` | Configuration | ⚠️ Check route |

### Global Actions
| Route | Purpose | Status |
|-------|---------|--------|
| `/command` | Command center | ⚠️ Check route |
| `/settings` | User settings | ⚠️ Check route |

---

## Next Steps

### 1. Verify Routes Exist
Check which routes are already implemented:

```bash
ls -la src/app/deals/
ls -la src/app/borrower-portal/
ls -la src/app/documents/
ls -la src/app/underwrite/
ls -la src/app/pricing/
ls -la src/app/credit-memo/
ls -la src/app/servicing/
ls -la src/app/admin/
ls -la src/app/command/
ls -la src/app/settings/
```

### 2. Create Missing Routes
For any missing route, create a placeholder:

```tsx
// src/app/underwrite/page.tsx
export default function UnderwritePage() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold">Underwrite</h1>
      <p className="text-white/60">Turn documents into risk facts</p>
    </div>
  );
}
```

### 3. Build Deal Command Center
Create the hub screen at `/deals/[dealId]`:

**Purpose:**
- Single source of truth for deal state
- Quick actions (Run Intel, Generate Memo, Quote Pricing)
- Jump to any module from here

**Components needed:**
- Deal snapshot card
- Intel panel
- Pricing quote panel
- Quick nav to sub-modules

### 4. Wire Flow Transitions
Add "Next Step" buttons that follow the canonical flow:

```tsx
// Example: On Documents page
<Link href="/underwrite" className="btn-primary">
  Next: Underwrite →
</Link>
```

---

## Customization

### Change Navigation Items
Edit [src/components/nav/HeroBar.tsx](../src/components/nav/HeroBar.tsx):

```tsx
const NAV = [
  { href: "/deals", label: "Deals" },
  { href: "/your-route", label: "Your Label" },
  // ...
];
```

### Change Grouping
Edit [src/components/nav/HeroBarGrouped.tsx](../src/components/nav/HeroBarGrouped.tsx):

```tsx
const NAV_GROUPS = [
  {
    label: "Your Phase",
    items: [
      { href: "/route1", label: "Label 1" },
      { href: "/route2", label: "Label 2" },
    ],
  },
];
```

### Change Styling
Both components use Tailwind CSS classes:

```tsx
// Active link
"bg-white/10 text-white"

// Inactive link
"text-white/70 hover:text-white hover:bg-white/5"

// Container
"bg-black/70 backdrop-blur"
```

---

## Design Principles

### 1. Sticky Top Bar
- Always visible
- Provides context + escape hatch
- No scrolling required

### 2. Active Route Highlighting
- Uses `usePathname()` from Next.js
- Matches on route prefix (e.g., `/deals` matches `/deals/123`)
- Visual feedback for current location

### 3. Mobile-First
- Desktop: Full nav inline
- Mobile: Horizontal scroll
- No hamburger menu needed (all visible)

### 4. Glassmorphism
- `bg-black/70 backdrop-blur`
- Semi-transparent with blur
- Modern, premium feel

---

## Flow Integration

The navigation reflects the canonical flow from [FLOW.md](FLOW.md):

```
Entry → Deals → Deal Hub → [Acquire|Decide|Operate] → Close
```

**Key insight:** Every screen should either:
1. Show path to next screen (forward)
2. Show path to hub (escape hatch)
3. Show path to previous screen (back)

---

## File Structure

```
docs/
├── FLOW.md                          ← Canonical screen flow
└── NAVIGATION_SYSTEM.md             ← This file

src/
├── app/
│   └── layout.tsx                   ← HeroBar mounted here
└── components/
    └── nav/
        ├── HeroBar.tsx              ← Simple flat navigation
        └── HeroBarGrouped.tsx       ← Grouped by phase
```

---

## Testing

### 1. Visual Check
Start dev server and visit any page:

```bash
npm run dev
# Visit http://localhost:3000
```

**Should see:**
- Hero bar at top
- "Buddy The Underwriter" branding
- All nav links
- Active route highlighted
- Mobile nav on small screens

### 2. Navigation Check
Click through all links:
- Verify routes exist or show 404
- Verify active highlighting follows
- Verify mobile nav scrolls

### 3. Sticky Behavior
Scroll down any page:
- Hero bar should stay at top
- Should remain visible while scrolling

---

## FAQ

### Q: Why is the bar always visible?
**A:** Users need constant context (where am I?) and escape hatches (how do I get out?). Hiding nav creates friction.

### Q: Why not a sidebar?
**A:** Horizontal space is precious for data-heavy screens (spreads, tables). Top bar preserves horizontal real estate.

### Q: What about breadcrumbs?
**A:** Add them below the hero bar for deep hierarchies:
```tsx
<div className="px-4 py-2 text-sm text-white/60">
  Deals / ABC Corp / Documents / Bank Statement
</div>
```

### Q: Can I hide it on certain pages?
**A:** Yes, but avoid it. If you must:
```tsx
// In specific page component
<div className="relative">
  <style jsx global>{`
    nav { display: none; }
  `}</style>
  {/* page content */}
</div>
```

---

## Success Criteria

✅ **Navigation Complete When:**
1. Hero bar visible on every page
2. Active route highlighting works
3. All nav links go to valid routes
4. Mobile nav scrolls smoothly
5. Flow document matches reality

✅ **Product Coherence Achieved When:**
1. Users can navigate entire app without getting lost
2. Every screen has clear purpose (per FLOW.md)
3. Next steps are obvious
4. Command center provides escape hatch
5. No orphaned pages
