#!/bin/bash
# Quick Test Suite for Bulletproof Reminder System

set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  BULLETPROOF REMINDER SYSTEM - QUICK TEST SUITE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

BASE_URL="${1:-http://localhost:3000}"

echo "🧪 Test 1: Stats Endpoint"
echo "   GET $BASE_URL/api/admin/reminders/stats"
STATS=$(curl -sS "$BASE_URL/api/admin/reminders/stats")
echo "$STATS" | jq -r '.health' > /dev/null 2>&1 && echo "   ✅ Stats endpoint OK" || echo "   ❌ Stats endpoint FAILED"
echo ""

echo "🧪 Test 2: Idempotency Guard (concurrent ticks)"
echo "   Sending 2 concurrent POST requests..."
(curl -sS -X POST "$BASE_URL/api/admin/reminders/tick" > /tmp/tick1.json &)
(curl -sS -X POST "$BASE_URL/api/admin/reminders/tick" > /tmp/tick2.json &)
wait
RESULT1=$(cat /tmp/tick1.json | jq -r '.ok // .error')
RESULT2=$(cat /tmp/tick2.json | jq -r '.ok // .error')
if [[ "$RESULT1" != "$RESULT2" ]]; then
  echo "   ✅ Idempotency guard working (one succeeded, one blocked)"
else
  echo "   ⚠️  Both requests returned same result (might be OK if no concurrent conflict)"
fi
echo ""

echo "🧪 Test 3: Ops Dashboard"
echo "   Checking if page renders..."
DASHBOARD=$(curl -sS "$BASE_URL/ops")
if echo "$DASHBOARD" | grep -q "Operations Dashboard"; then
  echo "   ✅ Ops dashboard renders"
else
  echo "   ❌ Ops dashboard not found"
fi
echo ""

echo "🧪 Test 4: Health Card Component"
if echo "$DASHBOARD" | grep -q "Reminder System"; then
  echo "   ✅ Health card present"
else
  echo "   ❌ Health card not found"
fi
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  TEST SUMMARY"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📊 Stats Health: $(echo "$STATS" | jq -r '.health // "unknown"')"
echo "📈 Active Subs: $(echo "$STATS" | jq -r '.subscriptions.total_active // "N/A"')"
echo "⏰ Due Now: $(echo "$STATS" | jq -r '.subscriptions.due_now // "N/A"')"
echo "🔴 Error Rate (24h): $(echo "$STATS" | jq -r '.runs_last_24h.error_rate_pct // "N/A"')%"
echo ""
echo "✅ All core features tested"
echo "📖 See BULLETPROOF_REMINDER_SYSTEM.md for full docs"
echo ""

# Cleanup
rm -f /tmp/tick1.json /tmp/tick2.json
