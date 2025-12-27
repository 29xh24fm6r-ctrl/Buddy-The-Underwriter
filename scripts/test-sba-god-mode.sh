#!/bin/bash
# Test script for SBA God Mode agents

echo "🧠 SBA God Mode - Agent System Test"
echo "===================================="
echo ""

# Check if migration file exists
echo "✓ Checking migration file..."
if [ -f "supabase/migrations/20251227000001_create_agent_findings.sql" ]; then
    echo "  ✓ Migration file exists"
else
    echo "  ✗ Migration file missing"
    exit 1
fi

# Check if agent files exist
echo ""
echo "✓ Checking agent implementation files..."

files=(
    "src/lib/agents/types.ts"
    "src/lib/agents/base.ts"
    "src/lib/agents/orchestrator.ts"
    "src/lib/agents/sba-policy.ts"
    "src/lib/agents/eligibility.ts"
    "src/lib/agents/cash-flow.ts"
    "src/lib/agents/risk.ts"
    "src/lib/agents/index.ts"
)

for file in "${files[@]}"; do
    if [ -f "$file" ]; then
        echo "  ✓ $file"
    else
        echo "  ✗ $file MISSING"
        exit 1
    fi
done

# Check API routes
echo ""
echo "✓ Checking API routes..."

routes=(
    "src/app/api/deals/[dealId]/agents/execute/route.ts"
    "src/app/api/deals/[dealId]/agents/status/route.ts"
    "src/app/api/deals/[dealId]/agents/findings/route.ts"
)

for route in "${routes[@]}"; do
    if [ -f "$route" ]; then
        echo "  ✓ $route"
    else
        echo "  ✗ $route MISSING"
        exit 1
    fi
done

# Check UI component
echo ""
echo "✓ Checking UI components..."
if [ -f "src/components/agents/AgentCockpit.tsx" ]; then
    echo "  ✓ AgentCockpit.tsx"
else
    echo "  ✗ AgentCockpit.tsx MISSING"
    exit 1
fi

# Count lines of code
echo ""
echo "📊 Implementation Stats:"
echo "  Agent implementations: $(ls src/lib/agents/*.ts 2>/dev/null | wc -l) files"
echo "  API routes: $(ls src/app/api/deals/\[dealId\]/agents/*/route.ts 2>/dev/null | wc -l) endpoints"
echo "  Total agent code: $(cat src/lib/agents/*.ts 2>/dev/null | wc -l) lines"

echo ""
echo "===================================="
echo "✅ SBA God Mode Phase 1 Complete!"
echo "===================================="
echo ""
echo "Next steps:"
echo "  1. Apply migration: Run migration in Supabase SQL Editor"
echo "  2. Test execution: POST /api/deals/{dealId}/agents/execute"
echo "  3. View UI: Add <AgentCockpit dealId={dealId} /> to deal page"
echo "  4. Phase 2: Implement remaining agents (Credit, Collateral, etc.)"
echo ""
