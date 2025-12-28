#!/bin/bash
# Quick migration runner - paste your Supabase connection string when prompted

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${YELLOW}=== RPC Security Migration Runner ===${NC}\n"

if [ -z "$DATABASE_URL" ]; then
  echo -e "${YELLOW}DATABASE_URL not set.${NC}"
  echo ""
  echo "Get it from: Supabase Dashboard → Settings → Database → Connection string (URI)"
  echo "Format: postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres"
  echo ""
  read -p "Paste your DATABASE_URL: " DB_URL
  export DATABASE_URL="$DB_URL"
fi

MIGRATION="supabase/migrations/20251228_rpc_security_twilio.sql"

echo -e "${GREEN}✓ Applying migration: $MIGRATION${NC}\n"

psql "$DATABASE_URL" -f "$MIGRATION"

echo -e "\n${GREEN}✓ Migration complete!${NC}\n"
echo "Verifying RPCs created:"
psql "$DATABASE_URL" -c "SELECT routine_name FROM information_schema.routines WHERE routine_name LIKE 'portal_%' ORDER BY routine_name;"

echo -e "\nNext: Test the checklist seeding and borrower portal flow"
