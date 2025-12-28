#!/bin/bash
# Verify borrower submission completed successfully

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

DEAL_ID=$1

if [ -z "$DEAL_ID" ]; then
  echo -e "${RED}Usage: $0 <deal_id>${NC}"
  exit 1
fi

if [ -z "$DATABASE_URL" ]; then
  echo -e "${RED}DATABASE_URL not set${NC}"
  exit 1
fi

echo -e "${CYAN}╔════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  SUBMISSION VERIFICATION                   ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════╝${NC}\n"

echo -e "${YELLOW}Deal ID: $DEAL_ID${NC}\n"

# 1. Doc Submissions
echo -e "${CYAN}━━━ 1. Doc Submissions ━━━${NC}\n"

SUBMISSION_COUNT=$(psql "$DATABASE_URL" -t -c "
  SELECT COUNT(*) FROM public.doc_submissions WHERE deal_id = '$DEAL_ID';
")

if [ "$SUBMISSION_COUNT" -eq 0 ]; then
  echo -e "${RED}✗ No submissions found${NC}"
  echo "Action: Borrower needs to complete the upload flow"
  exit 1
fi

echo -e "${GREEN}✓ $SUBMISSION_COUNT submission(s) found${NC}\n"

psql "$DATABASE_URL" -c "
  SELECT 
    id, 
    upload_id,
    substring(token, 1, 12) || '...' as token,
    status,
    created_at
  FROM public.doc_submissions
  WHERE deal_id = '$DEAL_ID'
  ORDER BY created_at DESC;
"

# 2. Checklist Items Received
echo -e "\n${CYAN}━━━ 2. Checklist Items Received ━━━${NC}\n"

RECEIVED_COUNT=$(psql "$DATABASE_URL" -t -c "
  SELECT COUNT(*) FROM public.deal_checklist_items 
  WHERE deal_id = '$DEAL_ID' AND received_at IS NOT NULL;
")

REQUIRED_COUNT=$(psql "$DATABASE_URL" -t -c "
  SELECT COUNT(*) FROM public.deal_checklist_items 
  WHERE deal_id = '$DEAL_ID' AND required = true;
")

echo "Required items: $REQUIRED_COUNT"
echo "Received items: $RECEIVED_COUNT"

if [ "$RECEIVED_COUNT" -eq 0 ]; then
  echo -e "${YELLOW}⚠️  No items marked as received yet${NC}"
  echo "This might mean:"
  echo "  - Document classification didn't match a checklist item"
  echo "  - Checklist matching logic needs adjustment"
else
  echo -e "${GREEN}✓ Items received${NC}\n"
  
  psql "$DATABASE_URL" -c "
    SELECT 
      checklist_key,
      title,
      received_at,
      received_upload_id
    FROM public.deal_checklist_items
    WHERE deal_id = '$DEAL_ID'
      AND received_at IS NOT NULL
    ORDER BY received_at DESC;
  "
fi

# 3. Underwriting Readiness
echo -e "\n${CYAN}━━━ 3. Underwriting Readiness ━━━${NC}\n"

READY_INFO=$(psql "$DATABASE_URL" -t -A -F'|' -c "
  SELECT 
    underwriting_ready_at,
    underwriting_started_at,
    stage
  FROM public.deals
  WHERE id = '$DEAL_ID';
")

READY_AT=$(echo "$READY_INFO" | cut -d'|' -f1)
STARTED_AT=$(echo "$READY_INFO" | cut -d'|' -f2)
STAGE=$(echo "$READY_INFO" | cut -d'|' -f3)

echo "Current stage: $STAGE"
echo "Ready at:      ${READY_AT:-Not yet}"
echo "Started at:    ${STARTED_AT:-Not yet}"

if [ "$REQUIRED_COUNT" -gt 0 ] && [ "$RECEIVED_COUNT" -eq "$REQUIRED_COUNT" ]; then
  if [ -z "$READY_AT" ]; then
    echo -e "\n${YELLOW}⚠️  All required items received but underwriting_ready_at not set${NC}"
    echo "This might mean:"
    echo "  - Trigger didn't fire (check logs)"
    echo "  - Run manually: SELECT public.try_mark_deal_underwriting_ready('$DEAL_ID');"
  else
    echo -e "\n${GREEN}✓ Deal ready for underwriting!${NC}"
  fi
else
  echo -e "\n${YELLOW}⚠️  Still waiting for required items: $((REQUIRED_COUNT - RECEIVED_COUNT)) remaining${NC}"
fi

# 4. Deal Events (Audit Trail)
echo -e "\n${CYAN}━━━ 4. Deal Events (Last 20) ━━━${NC}\n"

psql "$DATABASE_URL" -c "
  SELECT 
    created_at::timestamp,
    kind,
    metadata->'field_key' as field,
    metadata->'upload_id' as upload,
    metadata->'required_total' as req_total,
    metadata->'required_received' as req_received
  FROM public.deal_events
  WHERE deal_id = '$DEAL_ID'
  ORDER BY created_at DESC
  LIMIT 20;
"

# 5. Portal Link Status
echo -e "\n${CYAN}━━━ 5. Portal Link Status ━━━${NC}\n"

psql "$DATABASE_URL" -c "
  SELECT 
    label,
    single_use,
    expires_at,
    used_at,
    created_at
  FROM public.borrower_portal_links
  WHERE deal_id = '$DEAL_ID'
  ORDER BY created_at DESC
  LIMIT 3;
"

# Summary
echo -e "\n${CYAN}━━━ SUMMARY ━━━${NC}\n"

if [ "$SUBMISSION_COUNT" -gt 0 ] && [ "$RECEIVED_COUNT" -gt 0 ]; then
  echo -e "${GREEN}✓ Borrower flow working!${NC}"
  echo "  - Submissions created"
  echo "  - Checklist items received"
  if [ -n "$READY_AT" ]; then
    echo "  - Underwriting readiness triggered"
  fi
else
  echo -e "${YELLOW}⚠️  Partial completion${NC}"
  echo "  Check the logs above for details"
fi

echo ""
