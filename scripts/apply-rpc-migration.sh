#!/bin/bash
# Apply RPC security + Twilio migration to Supabase

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}=== Buddy RPC Security + Twilio Migration ===${NC}\n"

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
  echo -e "${RED}ERROR: DATABASE_URL not set${NC}"
  echo "Get connection string from Supabase Dashboard → Settings → Database → Connection string (URI)"
  echo "Then run: export DATABASE_URL='postgresql://...'"
  exit 1
fi

# Check if psql is available
if ! command -v psql &> /dev/null; then
  echo -e "${RED}ERROR: psql not found${NC}"
  echo "Install PostgreSQL client tools:"
  echo "  macOS: brew install postgresql"
  echo "  Ubuntu: sudo apt-get install postgresql-client"
  exit 1
fi

echo -e "${GREEN}✓ DATABASE_URL set${NC}"
echo -e "${GREEN}✓ psql found${NC}\n"

# Migration file
MIGRATION_FILE="supabase/migrations/20251228_rpc_security_twilio.sql"

if [ ! -f "$MIGRATION_FILE" ]; then
  echo -e "${RED}ERROR: Migration file not found: $MIGRATION_FILE${NC}"
  exit 1
fi

echo -e "${YELLOW}Applying migration: $MIGRATION_FILE${NC}\n"

# Apply migration
psql "$DATABASE_URL" -f "$MIGRATION_FILE"

echo -e "\n${GREEN}✓ Migration applied successfully!${NC}\n"

# Verification queries
echo -e "${YELLOW}Verifying migration...${NC}\n"

echo "1. Checking RPC functions:"
psql "$DATABASE_URL" -c "SELECT routine_name FROM information_schema.routines WHERE routine_name LIKE 'portal_%';"

echo -e "\n2. Checking tables:"
psql "$DATABASE_URL" -c "SELECT table_name FROM information_schema.tables WHERE table_name IN ('borrower_portal_links', 'outbound_messages');"

echo -e "\n3. Checking anon grants:"
psql "$DATABASE_URL" -c "SELECT routine_name FROM information_schema.routine_privileges WHERE grantee = 'anon' AND routine_name LIKE 'portal_%';"

echo -e "\n${GREEN}=== Migration Complete! ===${NC}\n"
echo "Next steps:"
echo "  1. Add Twilio env vars to .env.local (see .env.example)"
echo "  2. Test with: ./test-borrower-portal-sms.sh <deal_id> <phone>"
echo "  3. Deploy to Vercel"
echo ""
