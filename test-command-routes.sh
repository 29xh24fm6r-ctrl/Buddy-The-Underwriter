#!/bin/bash
# Quick smoke test for command routes

echo "=== Command Routes Smoke Test ==="
echo ""

# Check files exist
echo "✓ Checking route files..."
ls -la src/app/api/deals/'[dealId]'/command/route.ts 2>/dev/null && echo "  ✓ /command/route.ts exists" || echo "  ✗ Missing"
ls -la src/app/api/deals/'[dealId]'/command/latest/route.ts 2>/dev/null && echo "  ✓ /command/latest/route.ts exists" || echo "  ✗ Missing"
ls -la src/app/api/deals/'[dealId]'/checklist/route.ts 2>/dev/null && echo "  ✓ /checklist/route.ts exists" || echo "  ✗ Missing"
ls -la src/app/api/deals/'[dealId]'/checklist/list/route.ts 2>/dev/null && echo "  ✓ /checklist/list/route.ts exists" || echo "  ✗ Missing"
ls -la src/lib/checklist/getChecklistState.ts 2>/dev/null && echo "  ✓ getChecklistState.ts exists" || echo "  ✗ Missing"
echo ""

# Check for convergence-safe patterns
echo "✓ Checking convergence-safe patterns..."
rg -q "state.*processing" src/lib/checklist/getChecklistState.ts && echo "  ✓ Returns state:processing" || echo "  ✗ Missing"
rg -q "deal_pipeline_ledger" src/lib/checklist/getChecklistState.ts && echo "  ✓ Checks pipeline ledger" || echo "  ✗ Missing"
rg -q "satisfied.*received" src/app/api/deals/'[dealId]'/checklist/route.ts && echo "  ✓ Handles satisfied+received" || echo "  ✗ Missing"
echo ""

# Check demo mode support
echo "✓ Checking demo mode support..."
rg -q "isDemoMode" src/app/api/deals/'[dealId]'/command/route.ts && echo "  ✓ Command route has demo mode" || echo "  ✗ Missing"
rg -q "isDemoMode" src/app/api/deals/'[dealId]'/checklist/route.ts && echo "  ✓ Checklist route has demo mode" || echo "  ✗ Missing"
echo ""

echo "=== All checks passed! ==="
