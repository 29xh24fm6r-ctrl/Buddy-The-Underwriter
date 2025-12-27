#!/bin/bash
# Test contact API with existing env keys

echo "🧪 Testing /api/contact with discovered env keys"
echo "================================================="
echo ""

# Test 1: Missing fields
echo "Test 1: Missing fields (should return 400)"
curl -sS -X POST "http://localhost:3000/api/contact" \
  -H "content-type: application/json" \
  -d '{}' | jq .
echo ""

# Test 2: Valid data
echo "Test 2: Valid contact submission"
curl -sS -X POST "http://localhost:3000/api/contact" \
  -H "content-type: application/json" \
  -d '{
    "name":"Test Sender",
    "email":"sender@example.com",
    "company":"Acme Bank",
    "message":"Hello, I want to learn more about Buddy."
  }' | jq .
echo ""

echo "Expected results:"
echo "  - Test 1: {\"ok\":false,\"error\":\"Missing required fields...\"}"
echo "  - Test 2: "
echo "    - If EMAIL_FROM + CONTACT_TO_EMAIL set: {\"ok\":true,\"id\":\"...\"}"
echo "    - If keys missing: {\"ok\":false,\"error\":\"Email routing not configured\"}"
echo "    - Should show which keys it's using in debug output"
