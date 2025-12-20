#!/bin/bash
# test-banker-dashboard.sh
# Quick acceptance test for Master Banker Control Panel

set -e

echo "🎯 Testing Master Banker Control Panel"
echo ""

# Test 1: Overview API
echo "Test 1: Dashboard Overview (global)"
curl -s -X POST http://localhost:3000/api/dashboard/overview \
  -H "content-type: application/json" \
  -d '{"filters":{}}' | jq -r '.ok, .kpis.totals'

echo ""

# Test 2: Filtered by user
echo "Test 2: Dashboard Overview (filtered by user)"
curl -s -X POST http://localhost:3000/api/dashboard/overview \
  -H "content-type: application/json" \
  -d '{"filters":{"userId":"YOUR_USER_UUID_HERE"}}' | jq -r '.ok, .kpis.totals'

echo ""

# Test 3: Predictions refresh
echo "Test 3: Refresh Predictions"
curl -s -X POST http://localhost:3000/api/dashboard/predictions/refresh | jq -r '.ok, .refreshed'

echo ""
echo "✅ All API tests complete"
echo ""
echo "🌐 Next: Visit http://localhost:3000/banker/dashboard in browser"
