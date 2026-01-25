#!/bin/bash
# Guardrail: Ensure no rogue polling creeps back into cockpit widgets
#
# Cockpit components should use useShouldPoll() from @/buddy/cockpit
# instead of raw setInterval/refreshInterval.
#
# Allowlist (files that may use setInterval without useShouldPoll):
# - src/buddy/cockpit/useCockpitData.tsx (the centralized polling hook)
# - src/lib/pipeline/usePipelineState.ts (pipeline state hook)
# - src/components/deals/DealCockpitLoadingBar.tsx (debug/resolution bar)
# - src/components/deals/DealIntakeCard.tsx (1s readiness polling during intake)

set -e

echo "🔍 Checking for rogue polling in cockpit components..."

# Define cockpit-related paths to check
COCKPIT_PATHS="src/components/deals/DealCockpitClient.tsx \
src/components/deals/DealFilesCard.tsx \
src/components/deals/DealCockpitNarrator.tsx \
src/components/deals/DealProgressWidget.tsx \
src/components/deals/EnhancedChecklistCard.tsx \
src/components/deals/LifecycleStatusPanel.tsx \
src/components/deals/DealCockpitInsights.tsx \
src/components/deals/DocumentClassificationInbox.tsx \
src/components/deals/DealOutputsPanel.tsx"

VIOLATIONS=""
for file in $COCKPIT_PATHS; do
  if [ -f "$file" ]; then
    # Check if file uses setInterval/refreshInterval
    if grep -q "setInterval\|refreshInterval" "$file" 2>/dev/null; then
      # If it does, verify it also uses useShouldPoll or has polling-allowed comment
      if ! grep -q "useShouldPoll\|// polling-allowed" "$file" 2>/dev/null; then
        VIOLATIONS="$VIOLATIONS\n  - $file"
      fi
    fi
  fi
done

if [ -n "$VIOLATIONS" ]; then
  echo "❌ Found potential polling violations:"
  echo -e "$VIOLATIONS"
  echo ""
  echo "These files use setInterval/refreshInterval without useShouldPoll."
  echo "Please either:"
  echo "  1. Use useShouldPoll() from @/buddy/cockpit for conditional polling"
  echo "  2. Add '// polling-allowed' comment if this is intentional"
  exit 1
fi

echo "✅ No rogue polling detected in cockpit components."

# Show usage of useShouldPoll
echo ""
echo "📊 Cockpit polling pattern usage:"
for file in $COCKPIT_PATHS; do
  if [ -f "$file" ]; then
    if grep -q "useShouldPoll" "$file" 2>/dev/null; then
      echo "  ✓ $file (uses useShouldPoll)"
    elif grep -q "setInterval\|refreshInterval" "$file" 2>/dev/null; then
      if grep -q "// polling-allowed" "$file" 2>/dev/null; then
        echo "  ⚠ $file (polling-allowed exception)"
      fi
    else
      echo "  · $file (no polling)"
    fi
  fi
done

exit 0
