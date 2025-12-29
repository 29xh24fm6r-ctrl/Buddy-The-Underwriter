#!/bin/bash
# Verify Clerk auth setup is complete

echo "🔍 Verifying Clerk Auth Setup..."
echo ""

# Check files exist
echo "📁 Checking files..."
files=(
  "src/app/sign-in/[[...sign-in]]/page.tsx"
  "src/app/sign-up/[[...sign-up]]/page.tsx"
  "src/app/api/auth/supabase-jwt/route.ts"
  "src/middleware.ts"
  "supabase/migrations/20251229000000_create_app_users_and_platform_admins.sql"
)

all_exist=true
for file in "${files[@]}"; do
  if [ -f "$file" ]; then
    echo "  ✅ $file"
  else
    echo "  ❌ $file (missing)"
    all_exist=false
  fi
done

echo ""
echo "📦 Checking dependencies..."
if grep -q '"jose"' package.json; then
  echo "  ✅ jose installed"
else
  echo "  ❌ jose missing from package.json"
  all_exist=false
fi

echo ""
echo "🔧 Checking environment variables..."
if [ -f ".env.local" ]; then
  echo "  ℹ️  .env.local exists"
  
  required_vars=(
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"
    "CLERK_SECRET_KEY"
    "NEXT_PUBLIC_SUPABASE_URL"
    "SUPABASE_SERVICE_ROLE_KEY"
    "SUPABASE_JWT_SECRET"
  )
  
  for var in "${required_vars[@]}"; do
    if grep -q "^$var=" .env.local 2>/dev/null; then
      echo "  ✅ $var set"
    else
      echo "  ⚠️  $var not found in .env.local"
    fi
  done
else
  echo "  ⚠️  .env.local not found"
fi

echo ""
echo "🔍 Checking marketing page updates..."
if grep -q 'href="/sign-up"' src/components/marketing/Hero.tsx; then
  echo "  ✅ Hero CTA points to /sign-up"
else
  echo "  ❌ Hero CTA not updated"
  all_exist=false
fi

if grep -q 'href="/sign-up"' src/components/marketing/TopNav.tsx; then
  echo "  ✅ TopNav has Sign Up button"
else
  echo "  ❌ TopNav not updated"
  all_exist=false
fi

echo ""
if [ "$all_exist" = true ]; then
  echo "✅ Setup verification complete!"
  echo ""
  echo "📝 Next steps:"
  echo "1. Run migration: ./scripts/apply-auth-migration.sh"
  echo "2. Add SUPABASE_JWT_SECRET to .env.local"
  echo "3. Start dev server: npm run dev"
  echo "4. Visit http://localhost:3000 and test sign-up"
else
  echo "❌ Some checks failed. See above for details."
  exit 1
fi
