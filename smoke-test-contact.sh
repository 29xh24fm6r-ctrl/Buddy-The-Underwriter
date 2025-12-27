#!/bin/bash
echo "🧪 Contact API Smoke Test"
echo "========================="
echo ""

echo "Testing /api/contact with:"
echo "  FROM: EMAIL_FROM or OUTBOUND_FROM_EMAIL"
echo "  TO: CONTACT_TO_EMAIL"
echo ""

curl -sS -X POST "http://localhost:3000/api/contact" \
  -H "content-type: application/json" \
  -d '{
    "name":"Test Sender",
    "email":"sender@example.com",
    "company":"Acme Bank",
    "subject":"Hello from smoke test",
    "message":"This is a test message from the contact form."
  }' | jq .

echo ""
echo "Expected:"
echo "  ✅ {\"ok\":true} - email sent via Resend"
echo "  FROM: Underwriting <underwriting@buddytheunderwriter.com>"
echo "  TO: sales@buddytheunderwriter.com"
echo "  REPLY-TO: sender@example.com"
