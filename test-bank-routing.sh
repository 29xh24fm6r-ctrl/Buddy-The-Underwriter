#!/bin/bash
set -e

echo "╔═══════════════════════════════════════════════════════════╗"
echo "║  Bank Email Routing — Smoke Tests                        ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

# Test 1: Env fallback (no bank context)
echo "1️⃣  Test env fallback (no bank_id)"
curl -sS -X POST "http://localhost:3000/api/contact" \
  -H "content-type: application/json" \
  -d '{
    "name":"Env Fallback Test",
    "email":"test@example.com",
    "company":"Test Co",
    "subject":"Env routing test",
    "message":"Should use EMAIL_FROM and CONTACT_TO_EMAIL"
  }' | python3 -m json.tool || echo "⚠️  FAILED (is dev server running?)"

echo ""
echo "Expected: {\"ok\": true}"
echo "FROM: EMAIL_FROM (Underwriting <underwriting@buddytheunderwriter.com>)"
echo "TO: CONTACT_TO_EMAIL (sales@buddytheunderwriter.com)"
echo ""
echo "───────────────────────────────────────────────────────────"
echo ""

# Test 2: Explicit bank_id header
echo "2️⃣  Test explicit x-bank-id header"
echo "   (will use bank routing if configured in DB, else env fallback)"
curl -sS -X POST "http://localhost:3000/api/contact" \
  -H "content-type: application/json" \
  -H "x-bank-id: 00000000-0000-0000-0000-000000000000" \
  -d '{
    "name":"Bank Header Test",
    "email":"bank-test@example.com",
    "subject":"x-bank-id test",
    "message":"Testing explicit bank_id header routing"
  }' | python3 -m json.tool || echo "⚠️  FAILED"

echo ""
echo "Expected: {\"ok\": true}"
echo "Routing: Uses bank_email_routing table if exists, else env fallback"
echo ""
echo "───────────────────────────────────────────────────────────"
echo ""

# Test 3: Admin API GET
echo "3️⃣  Test admin API (GET routing config)"
curl -sS -X GET "http://localhost:3000/api/admin/banks/00000000-0000-0000-0000-000000000000/email-routing" \
  -H "content-type: application/json" | python3 -m json.tool || echo "⚠️  FAILED (auth required)"

echo ""
echo "Expected: {\"ok\": true, \"routing\": null} (if not configured)"
echo "Or: {\"ok\": false, \"error\": \"Forbidden\"} (if not super admin)"
echo ""
echo "───────────────────────────────────────────────────────────"
echo ""

echo "✅ Smoke tests complete"
echo ""
echo "To test portal token routing:"
echo "  1. Get a valid portal token from borrower_invites"
echo "  2. curl -H 'x-portal-token: TOKEN' ..."
echo ""
echo "Admin UI: http://localhost:3000/admin/email-routing?bankId=YOUR-BANK-UUID"
echo ""
