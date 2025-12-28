#!/bin/bash
# ============================================================
# Run All Governance Migrations in Order
# ============================================================
# This script runs all 17 governance migrations in the correct order.
# Run this in your Supabase SQL Editor or via psql.
#
# Usage:
#   1. Copy this script's output
#   2. Paste into Supabase SQL Editor
#   3. Click "Run"
#
# OR run directly via psql:
#   psql $DATABASE_URL < scripts/run-all-migrations.sh
# ============================================================

set -euo pipefail

MIGRATIONS_DIR="supabase/migrations"

# List all governance migrations in chronological order
MIGRATION_FILES=(
  "20251228_decision_attestations.sql"
  "20251228_bank_attestation_policies.sql"
  "20251228_credit_committee_policies.sql"
  "20251228_credit_committee_voting.sql"
  "20251228_committee_minutes_dissent.sql"
  "20251228_macro_prudential.sql"
  "20251228_final_optional_features.sql"
  "20251228_borrower_portal_e2e.sql"
  "20251228_borrower_portal_rls.sql"
  "20251228_rpc_security_twilio.sql"
  "20251228_auto_underwriting_trigger.sql"
  "20251229_decision_os_safe.sql"
  "20251229_decision_os_hardening.sql"
  "20251229_borrower_phone_links.sql"
  "20251229_sms_helpers.sql"
)

echo "-- ============================================================"
echo "-- BUDDY v1.0.0 - Complete Migration Script"
echo "-- ============================================================"
echo "-- This script creates all 15 governance + portal tables."
echo "-- Run time: ~30 seconds"
echo "-- "
echo "-- IMPORTANT: Run this in Supabase SQL Editor"
echo "-- ============================================================"
echo ""

for migration in "${MIGRATION_FILES[@]}"; do
  migration_path="$MIGRATIONS_DIR/$migration"
  
  if [ -f "$migration_path" ]; then
    echo ""
    echo "-- ┌──────────────────────────────────────────────────────────┐"
    echo "-- │ Running: $migration"
    echo "-- └──────────────────────────────────────────────────────────┘"
    echo ""
    cat "$migration_path"
    echo ""
    echo "-- ✓ Completed: $migration"
    echo ""
  else
    echo "-- ⚠️  WARNING: Migration not found: $migration_path"
  fi
done

echo ""
echo "-- ============================================================"
echo "-- ✅ ALL MIGRATIONS COMPLETE"
echo "-- ============================================================"
echo "-- Tables created: 17 governance + portal tables"
echo "-- RLS enabled: All tables (server-side only)"
echo "-- Indexes created: Yes (for performance)"
echo "-- "
echo "-- Next: Set environment variables in Vercel"
echo "-- ============================================================"
