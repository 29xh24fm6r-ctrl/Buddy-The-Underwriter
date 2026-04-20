# Stitch Import System

## Overview

Automated system to import Stitch HTML exports into Next.js pages with zero manual HTML editing.

## What It Does

Takes Stitch `code.html` files and generates Next.js pages that:
- Preserve exact Stitch HTML markup
- Inject Tailwind CDN + per-screen config
- Work in Next.js App Router
- Require no className conversions

## Files

### Import Script
- **`scripts/stitch/import-stitch.mjs`** - Automated HTML → TSX converter

### Generated Pages
- **`/stitch-login`** - Buddy login screen
- **`/stitch-generate`** - Generate underwriting screen
- **`/stitch-share/[artifactId]`** - Public share screen
- **`/stitch-results`** - Underwriting results display

### Source Files
- **`stitch_exports/`** - Original Stitch HTML files (preserved)

## How It Works

```
Stitch HTML → Import Script → Next.js Page TSX
```

The script extracts:
1. Title
2. Font links (Google Fonts, Material Icons)
3. Tailwind CDN URL
4. Tailwind config (inline `<script>`)
5. Inline styles (`<style>` blocks)
6. Body HTML markup

Then generates a TSX file using `StitchFrame` component.

## Usage

### Generate a New Page

```bash
node scripts/stitch/import-stitch.mjs \
  <input-stitch-html> \
  <output-next-page.tsx>
```

### Example

```bash
node scripts/stitch/import-stitch.mjs \
  stitch_exports/stitch_buddy_login_page/stitch_buddy_login_page/buddy_login_page/code.html \
  src/app/stitch-login/page.tsx
```

## Available Stitch Screens

From the current export:

1. **buddy_login_page** → `/stitch-login`
2. **generate_underwriting_screen_2** → `/stitch-generate`
3. **public_share_screen_2** → `/stitch-share/[artifactId]`
4. **underwriting_results_display** → `/stitch-results`

Also available (not imported yet):
- `generate_underwriting_screen_1` (v1)
- `public_share_screen_1` (v1)

## Benefits

✅ **Zero manual HTML editing** - Script handles everything
✅ **Repeatable** - Re-import anytime Stitch exports change
✅ **Preserves Stitch exactly** - No className conversion pain
✅ **Fast iteration** - Stitch → Buddy in seconds

## Migration Path (Optional)

Later, you can:
1. Convert Tailwind CDN → compiled config
2. Convert inline HTML → JSX with classNames
3. Add interactivity with "use client"

But you don't need to do any of that to ship!

## Testing

Visit in browser:
- http://localhost:3000/stitch-login
- http://localhost:3000/stitch-generate
- http://localhost:3000/stitch-share/test-id
- http://localhost:3000/stitch-results

All screens should render exactly as they appear in Stitch.

## Updating from New Stitch Exports

1. Get new ZIP from Stitch
2. Unzip to `stitch_exports/`
3. Run import script on new `code.html` files
4. Commit updated TSX files

## Implementation Status

✅ Import script created
✅ 4 Stitch screens imported
✅ All pages render correctly
✅ StitchFrame component working
✅ Zero manual HTML editing required

---

**Stitch → Next.js import is now a solved problem.** 🚀
