#!/bin/bash
set -e

echo "=== Tenant Email Routing Smoke Tests ==="
echo ""

# Test 1: Contact API with env fallback (no tenant routing)
echo "Test 1: Contact API with env fallback"
curl -sS -X POST "http://localhost:3000/api/contact" \
  -H "content-type: application/json" \
  -d '{
    "name":"Env Fallback Test",
    "email":"test@example.com",
    "company":"Test Bank",
    "subject":"Test from env routing",
    "message":"This should use EMAIL_FROM and CONTACT_TO_EMAIL from .env.local"
  }' | python3 -m json.tool || echo "FAILED"

echo ""
echo "Expected: {\"ok\": true}"
echo "FROM: EMAIL_FROM (Underwriting <underwriting@buddytheunderwriter.com>)"
echo "TO: CONTACT_TO_EMAIL (sales@buddytheunderwriter.com)"
echo "REPLY-TO: test@example.com (submitter)"
echo ""
echo "---"
echo ""

# Test 2: Admin API - Get routing (should return null for new bank)
echo "Test 2: Admin API - Get tenant routing (should return null or existing config)"
curl -sS -X GET "http://localhost:3000/api/admin/tenant/email-routing" \
  -H "content-type: application/json" | python3 -m json.tool || echo "FAILED"

echo ""
echo "Expected: {\"ok\": true, \"routing\": null} (if no config yet)"
echo ""
echo "---"
echo ""

echo "✅ Smoke tests complete"
echo ""
echo "To test tenant routing:"
echo "1. Set up a test bank in your DB"
echo "2. POST to /api/admin/tenant/email-routing with config"
echo "3. POST to /api/contact again - should use tenant config"
echo ""
echo "Admin UI: http://localhost:3000/admin/email-routing"
