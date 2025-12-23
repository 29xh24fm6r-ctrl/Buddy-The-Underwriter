#!/bin/bash
# Upgrade to HeroBarAdapted (recommended)

set -e

echo "🚀 Upgrading to Context-Aware Navigation"
echo "========================================"
echo ""

LAYOUT_FILE="src/app/layout.tsx"

if [ ! -f "$LAYOUT_FILE" ]; then
    echo "❌ Error: $LAYOUT_FILE not found"
    exit 1
fi

echo "📝 Current layout uses:"
grep "HeroBar" "$LAYOUT_FILE" || echo "  (no HeroBar found)"
echo ""

echo "💡 Recommended: Switch to HeroBarAdapted for context-aware navigation"
echo ""
echo "This will:"
echo "  ✅ Show global nav on deals list page"
echo "  ✅ Show deal-level nav on deal detail pages"
echo "  ✅ Use your existing routes (no broken links)"
echo ""

read -p "Apply upgrade? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

echo ""
echo "🔧 Updating $LAYOUT_FILE..."

# Create backup
cp "$LAYOUT_FILE" "${LAYOUT_FILE}.backup"
echo "   Created backup: ${LAYOUT_FILE}.backup"

# Update import
if grep -q 'from "@/components/nav/HeroBar"' "$LAYOUT_FILE"; then
    sed -i 's|from "@/components/nav/HeroBar"|from "@/components/nav/HeroBarAdapted"|g' "$LAYOUT_FILE"
    echo "   ✅ Updated import"
else
    echo "   ⚠️  Import not found - you may need to update manually"
fi

# Update component usage
if grep -q '<HeroBar />' "$LAYOUT_FILE"; then
    sed -i 's|<HeroBar />|<HeroBarAdapted />|g' "$LAYOUT_FILE"
    echo "   ✅ Updated component"
else
    echo "   ⚠️  Component not found - you may need to update manually"
fi

echo ""
echo "✅ Upgrade complete!"
echo ""
echo "📋 Next steps:"
echo "1. Start dev server: npm run dev"
echo "2. Visit /deals - should see global nav"
echo "3. Visit /deals/[dealId] - should see deal-level nav"
echo "4. If something breaks, restore backup:"
echo "   mv ${LAYOUT_FILE}.backup ${LAYOUT_FILE}"
echo ""
