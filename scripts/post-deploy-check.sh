#!/bin/bash
# Post-deployment verification script
# Usage: ./scripts/post-deploy-check.sh https://your-domain.com

set -e

if [ -z "$1" ]; then
    echo "Usage: $0 <production-url>"
    echo "Example: $0 https://buddy.example.com"
    exit 1
fi

DOMAIN="$1"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo "🔍 Buddy Post-Deployment Verification"
echo "====================================="
echo "Target: $DOMAIN"
echo ""

PASS=0
FAIL=0

check() {
    local name="$1"
    local command="$2"
    local expected="$3"
    
    echo -n "Checking $name... "
    
    if output=$(eval "$command" 2>&1); then
        if [[ -z "$expected" ]] || echo "$output" | grep -q "$expected"; then
            echo -e "${GREEN}✅ PASS${NC}"
            ((PASS++))
            return 0
        else
            echo -e "${RED}❌ FAIL${NC}"
            echo "  Expected: $expected"
            echo "  Got: $output"
            ((FAIL++))
            return 1
        fi
    else
        echo -e "${RED}❌ FAIL${NC}"
        echo "  Error: $output"
        ((FAIL++))
        return 1
    fi
}

# 1. Health endpoint (JSON)
check "Health endpoint (JSON)" \
    "curl -sS -f $DOMAIN/api/health" \
    '"status":"ok"'

# 2. Health page (HTML)
check "Health page (HTML)" \
    "curl -sS -f $DOMAIN/health" \
    "Buddy Underwriter"

# 3. Security headers - nosniff
check "Security header: X-Content-Type-Options" \
    "curl -sS -I $DOMAIN/ | grep -i x-content-type-options" \
    "nosniff"

# 4. Security headers - referrer
check "Security header: Referrer-Policy" \
    "curl -sS -I $DOMAIN/ | grep -i referrer-policy" \
    "origin-when-cross-origin"

# 5. Security headers - permissions
check "Security header: Permissions-Policy" \
    "curl -sS -I $DOMAIN/ | grep -i permissions-policy" \
    "camera"

# 6. Request ID header
check "Request ID header" \
    "curl -sS -I $DOMAIN/api/health | grep -i request-id" \
    "x-request-id"

# 7. Home page loads
check "Home page loads" \
    "curl -sS -f $DOMAIN/" \
    "<html"

# 8. Root redirects or loads
check "Root path accessible" \
    "curl -sS -w '%{http_code}' -o /dev/null $DOMAIN/" \
    "200"

# 9. API route exists (will 401/403 without auth, that's OK)
echo -n "Checking API route protection... "
STATUS=$(curl -sS -w '%{http_code}' -o /dev/null "$DOMAIN/api/deals/test/copilot" 2>&1 || echo "000")
if [[ "$STATUS" == "401" ]] || [[ "$STATUS" == "403" ]] || [[ "$STATUS" == "307" ]]; then
    echo -e "${GREEN}✅ PASS${NC} (auth required: $STATUS)"
    ((PASS++))
elif [[ "$STATUS" == "404" ]]; then
    echo -e "${YELLOW}⚠️  WARN${NC} (route not found, expected for dynamic routes)"
    ((PASS++))
else
    echo -e "${RED}❌ FAIL${NC} (unexpected status: $STATUS)"
    ((FAIL++))
fi

# 10. Not-found page works
check "404 page exists" \
    "curl -sS -w '%{http_code}' -o /dev/null $DOMAIN/nonexistent-page-12345" \
    "404"

# Summary
echo ""
echo "==========================================="
echo "Summary:"
echo -e "  ${GREEN}Passed: $PASS${NC}"
echo -e "  ${RED}Failed: $FAIL${NC}"
echo ""

if [ $FAIL -eq 0 ]; then
    echo -e "${GREEN}✅ ✅ ✅ ALL CHECKS PASSED ✅ ✅ ✅${NC}"
    echo ""
    echo "🎉 Production deployment verified!"
    echo ""
    echo "Optional next steps:"
    echo "  - Trigger an AI action and check logs for request IDs"
    echo "  - Test rate limiting (35 requests to same endpoint)"
    echo "  - Upload a document and verify OCR works"
    echo "  - Check browser console for any client errors"
    exit 0
else
    echo -e "${RED}❌ SOME CHECKS FAILED${NC}"
    echo ""
    echo "Review failed checks above and investigate."
    exit 1
fi
