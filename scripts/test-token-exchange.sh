#!/bin/bash
# Test the complete Clerk + Supabase token exchange integration

set -e

echo "🧪 Testing Token Exchange Integration..."
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check dev server is running
echo "1️⃣  Checking dev server..."
if curl -s http://localhost:3000/health > /dev/null 2>&1; then
  echo -e "  ${GREEN}✅ Dev server is running${NC}"
else
  echo -e "  ${RED}❌ Dev server not running${NC}"
  echo "  Start it with: npm run dev"
  exit 1
fi

echo ""
echo "2️⃣  Checking environment variables..."

# Check .env.local
if [ ! -f .env.local ]; then
  echo -e "  ${RED}❌ .env.local not found${NC}"
  exit 1
fi

required_vars=(
  "NEXT_PUBLIC_SUPABASE_URL"
  "NEXT_PUBLIC_SUPABASE_ANON_KEY"
  "SUPABASE_SERVICE_ROLE_KEY"
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"
  "CLERK_SECRET_KEY"
  "NEXT_PUBLIC_APP_URL"
)

all_set=true
for var in "${required_vars[@]}"; do
  if grep -q "^$var=" .env.local 2>/dev/null; then
    echo -e "  ${GREEN}✅ $var${NC}"
  else
    echo -e "  ${RED}❌ $var missing${NC}"
    all_set=false
  fi
done

if grep -q "^SUPABASE_JWT_SECRET=" .env.local 2>/dev/null; then
  echo -e "  ${GREEN}✅ SUPABASE_JWT_SECRET${NC}"
else
  echo -e "  ${YELLOW}⚠️  SUPABASE_JWT_SECRET not set${NC}"
  echo "     Get from: Supabase Dashboard > Settings > API > JWT Secret"
  echo "     Add to .env.local: SUPABASE_JWT_SECRET=your-secret"
  all_set=false
fi

if [ "$all_set" = false ]; then
  echo ""
  echo -e "${RED}❌ Some environment variables missing${NC}"
  exit 1
fi

echo ""
echo "3️⃣  Checking migration files..."
if [ -f "supabase/migrations/20251229000000_create_app_users_and_platform_admins.sql" ]; then
  echo -e "  ${GREEN}✅ app_users migration exists${NC}"
else
  echo -e "  ${RED}❌ app_users migration missing${NC}"
  exit 1
fi

if [ -f "supabase/migrations/20251229000001_create_whoami_function.sql" ]; then
  echo -e "  ${GREEN}✅ whoami function migration exists${NC}"
else
  echo -e "  ${RED}❌ whoami function migration missing${NC}"
  exit 1
fi

echo ""
echo "4️⃣  Checking client files..."
files=(
  "src/lib/auth/getSupabaseJwt.ts"
  "src/lib/supabase/browser.ts"
  "src/app/api/auth/supabase-jwt/route.ts"
)

for file in "${files[@]}"; do
  if [ -f "$file" ]; then
    echo -e "  ${GREEN}✅ $file${NC}"
  else
    echo -e "  ${RED}❌ $file missing${NC}"
    exit 1
  fi
done

echo ""
echo "5️⃣  Testing token exchange endpoint..."
echo ""
echo -e "${YELLOW}⚠️  This test requires you to be signed in via Clerk${NC}"
echo "  1. Open http://localhost:3000/sign-in in your browser"
echo "  2. Sign in with your account"
echo "  3. Open browser console (F12)"
echo "  4. Run this command:"
echo ""
echo -e "${GREEN}await fetch('/api/auth/supabase-jwt').then(r => r.json())${NC}"
echo ""
echo "  Expected response:"
echo '  { "token": "eyJ...", "buddyUserId": "uuid" }'
echo ""
echo "  Then test auth.uid() with:"
echo ""
echo -e "${GREEN}const { supabase } = await import('/src/lib/supabase/browser.ts');${NC}"
echo -e "${GREEN}await supabase.rpc('whoami').then(r => console.log(r.data));${NC}"
echo ""
echo "  Expected response:"
echo '  { "uid": "uuid", "role": "authenticated", ... }'
echo ""

echo "📊 Summary:"
echo ""
echo "✅ Environment configured"
echo "✅ Migration files present"
echo "✅ Client integration files present"
echo ""
echo "📝 Manual steps remaining:"
echo "1. Apply migrations (see TOKEN_EXCHANGE_VERIFICATION.md)"
echo "2. Add SUPABASE_JWT_SECRET to .env.local (if not set)"
echo "3. Restart dev server: npm run dev"
echo "4. Sign in and test token exchange (commands above)"
echo ""
echo "📚 Documentation:"
echo "- Quick start: AUTH_QUICKSTART.md"
echo "- Full verification: TOKEN_EXCHANGE_VERIFICATION.md"
echo ""
