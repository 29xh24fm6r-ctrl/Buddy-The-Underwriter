#!/bin/bash
# BORROWER PORTAL E2E TEST GUIDE
# Run this after applying the RPC migration

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}╔════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  BORROWER PORTAL E2E TEST GUIDE            ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════╝${NC}\n"

# Check for DATABASE_URL
if [ -z "$DATABASE_URL" ]; then
  echo -e "${YELLOW}⚠️  DATABASE_URL not set${NC}"
  echo "Get it from: Supabase Dashboard → Settings → Database → Connection string (URI)"
  read -p "Paste DATABASE_URL: " DB_URL
  export DATABASE_URL="$DB_URL"
fi

# Get deal_id
echo -e "\n${YELLOW}Enter your test deal ID:${NC}"
read -p "Deal ID: " DEAL_ID

if [ -z "$DEAL_ID" ]; then
  echo -e "${RED}Error: Deal ID required${NC}"
  exit 1
fi

# STEP 1: Check checklist items
echo -e "\n${CYAN}━━━ STEP 1: Verify Checklist Seeding ━━━${NC}\n"

CHECKLIST_COUNT=$(psql "$DATABASE_URL" -t -c "
  SELECT COUNT(*) FROM public.deal_checklist_items WHERE deal_id = '$DEAL_ID';
")

echo "Checklist items found: $CHECKLIST_COUNT"

if [ "$CHECKLIST_COUNT" -eq 0 ]; then
  echo -e "${YELLOW}⚠️  No checklist items found!${NC}"
  echo "Action: Click 'Save + Auto-Seed Checklist' in the deal cockpit"
  exit 1
fi

echo -e "${GREEN}✓ Checklist items exist${NC}\n"

psql "$DATABASE_URL" -c "
  SELECT checklist_key, title, required, received_at
  FROM public.deal_checklist_items
  WHERE deal_id = '$DEAL_ID'
  ORDER BY checklist_key;
"

# STEP 2: Check portal link
echo -e "\n${CYAN}━━━ STEP 2: Verify Portal Link ━━━${NC}\n"

LINK_COUNT=$(psql "$DATABASE_URL" -t -c "
  SELECT COUNT(*) FROM public.borrower_portal_links WHERE deal_id = '$DEAL_ID';
")

echo "Portal links found: $LINK_COUNT"

if [ "$LINK_COUNT" -eq 0 ]; then
  echo -e "${YELLOW}⚠️  No portal link found!${NC}"
  echo "Action: Create one via banker API:"
  echo ""
  echo "  curl -X POST http://localhost:3000/api/portal/create-link \\"
  echo "    -H 'Content-Type: application/json' \\"
  echo "    -d '{\"deal_id\":\"$DEAL_ID\"}'"
  echo ""
  exit 1
fi

echo -e "${GREEN}✓ Portal link exists${NC}\n"

PORTAL_INFO=$(psql "$DATABASE_URL" -t -A -F'|' -c "
  SELECT token, expires_at, used_at, single_use
  FROM public.borrower_portal_links
  WHERE deal_id = '$DEAL_ID'
  ORDER BY created_at DESC
  LIMIT 1;
")

TOKEN=$(echo "$PORTAL_INFO" | cut -d'|' -f1)
EXPIRES=$(echo "$PORTAL_INFO" | cut -d'|' -f2)
USED=$(echo "$PORTAL_INFO" | cut -d'|' -f3)
SINGLE_USE=$(echo "$PORTAL_INFO" | cut -d'|' -f4)

echo "Token:      ${TOKEN:0:16}..."
echo "Expires:    $EXPIRES"
echo "Used:       ${USED:-Not yet}"
echo "Single use: $SINGLE_USE"

APP_URL=${NEXT_PUBLIC_APP_URL:-http://localhost:3000}
PORTAL_URL="$APP_URL/upload/$TOKEN"

echo -e "\n${GREEN}Portal URL: $PORTAL_URL${NC}"

# STEP 3: Test RPC functions
echo -e "\n${CYAN}━━━ STEP 3: Test RPC Functions ━━━${NC}\n"

echo "Testing portal_get_context..."
psql "$DATABASE_URL" -c "SELECT * FROM public.portal_get_context('$TOKEN');"

echo -e "\nTesting portal_list_uploads..."
psql "$DATABASE_URL" -c "SELECT id, filename, status, doc_type FROM public.portal_list_uploads('$TOKEN');"

# STEP 4: Manual test instructions
echo -e "\n${CYAN}━━━ STEP 4: Manual Borrower Flow Test ━━━${NC}\n"

echo "Next steps (manual):"
echo ""
echo "1. Open: $PORTAL_URL"
echo ""
echo "2. Upload a test document (PDF, Excel, or Word)"
echo ""
echo "3. Confirm the extracted field values"
echo ""
echo "4. Click 'Confirm & Submit Document'"
echo ""
echo "5. Run verification queries:"
echo ""
echo "   ./tests/verify-submission.sh $DEAL_ID"
echo ""

# STEP 5: Offer to check current status
echo -e "${YELLOW}Press Enter to check current submission status...${NC}"
read -p ""

echo -e "\n${CYAN}━━━ Current Status ━━━${NC}\n"

echo "Doc Submissions:"
psql "$DATABASE_URL" -c "
  SELECT id, upload_id, status, created_at
  FROM public.doc_submissions
  WHERE deal_id = '$DEAL_ID'
  ORDER BY created_at DESC
  LIMIT 5;
"

echo -e "\nReceived Checklist Items:"
psql "$DATABASE_URL" -c "
  SELECT checklist_key, title, received_at
  FROM public.deal_checklist_items
  WHERE deal_id = '$DEAL_ID'
    AND received_at IS NOT NULL
  ORDER BY received_at DESC;
"

echo -e "\nDeal Readiness:"
psql "$DATABASE_URL" -c "
  SELECT 
    name,
    stage,
    underwriting_ready_at,
    underwriting_started_at
  FROM public.deals
  WHERE id = '$DEAL_ID';
"

echo -e "\nRecent Events:"
psql "$DATABASE_URL" -c "
  SELECT created_at, kind, metadata
  FROM public.deal_events
  WHERE deal_id = '$DEAL_ID'
  ORDER BY created_at DESC
  LIMIT 10;
"

echo -e "\n${GREEN}✓ Test guide complete!${NC}\n"
