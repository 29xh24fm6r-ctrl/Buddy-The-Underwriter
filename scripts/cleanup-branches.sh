#!/bin/bash
# Clean up merged and stale branches

echo "🧹 Branch Cleanup Tool"
echo "====================="
echo ""

# Branches that have been MERGED to main (safe to delete)
MERGED_BRANCHES=(
  "feat/pipeline-language"
  "feat/portal-bulletproof-ux"
  "feat/post-merge-upgrades"
  "feat/salvage-bulk-upload-pack"
)

# Branches that are STALE (3+ days old) - review before deleting
STALE_BRANCHES=(
  "fix/prod-deal-documents-source-check"
  "feat/pr-e-prod-sync-checklist-unblock"
  "feat/deal-intelligence-and-observability"
  "feat/pipeline-state-hook"
  "feat/refactor-writers-to-ingest"
  "feat/canonical-document-ingestion"
  "feat/magic-ux-narrator"
  "feat/wow-borrower-command-demo-summary"
  "feat/wow-pack-4in1"
  "feat/internal-test-mode"
  "fix/checklist-empty-not-error"
  "feat/marketing-wow-convergence"
  "fix/deal-intake-bank-id-canonical"
  "feat/checklist-engine-v2-pr"
  "feat/checklist-engine-v2"
  "feat/checklist-engine-v1"
  "fix/checklist-list-shape"
  "fix/intake-set-500"
  "fix/autoseed-intake-bankgrade"
  "fix/context-params-shape"
  "fix/context-invalid-dealid-null"
  "fix/react-418-upload-normalization"
  "feature/bulk-upload-pack"
)

# KEEP these branches
KEEP_BRANCHES=(
  "main"
  "feature/checklist-ux-improvements"  # Current PR #22
)

echo "✅ KEEP (Active):"
for branch in "${KEEP_BRANCHES[@]}"; do
  echo "   - $branch"
done
echo ""

echo "🗑️  DELETE (Merged to main - safe):"
for branch in "${MERGED_BRANCHES[@]}"; do
  echo "   - $branch"
done
echo ""

echo "⚠️  DELETE (Stale - 3+ days old):"
for branch in "${STALE_BRANCHES[@]}"; do
  echo "   - $branch"
done
echo ""

read -p "Delete merged branches? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  echo "Deleting merged branches..."
  for branch in "${MERGED_BRANCHES[@]}"; do
    git push origin --delete "$branch" 2>&1 | grep -v "error: unable to delete" || echo "   ✓ Deleted $branch"
  done
  echo "✅ Merged branches deleted!"
fi

echo ""
read -p "Delete stale branches? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  echo "Deleting stale branches..."
  for branch in "${STALE_BRANCHES[@]}"; do
    git push origin --delete "$branch" 2>&1 | grep -v "error: unable to delete" || echo "   ✓ Deleted $branch"
  done
  echo "✅ Stale branches deleted!"
fi

echo ""
echo "🎉 Cleanup complete!"
echo ""
echo "Remaining branches:"
git branch -r | grep -v "origin/HEAD" | sed 's/origin\///' | sort
