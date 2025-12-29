#!/bin/bash
# Apply the app_users and platform_admins migration to Supabase

set -e

echo "🔧 Applying app_users and platform_admins migration..."

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
  echo "❌ DATABASE_URL not set. Please set it to your Supabase connection string."
  echo ""
  echo "Example:"
  echo "export DATABASE_URL='postgresql://postgres:[password]@[project-ref].supabase.co:5432/postgres'"
  exit 1
fi

# Apply migration
psql "$DATABASE_URL" -f supabase/migrations/20251229000000_create_app_users_and_platform_admins.sql

echo ""
echo "✅ Migration applied successfully!"
echo ""
echo "📝 Next steps:"
echo "1. Add yourself as a platform admin:"
echo "   - Sign up via /sign-up in your app"
echo "   - Find your clerk_user_id in the Clerk dashboard"
echo "   - Run this SQL in Supabase:"
echo ""
echo "   INSERT INTO public.platform_admins (user_id)"
echo "   SELECT id FROM public.app_users WHERE clerk_user_id = 'user_XXXXXXXXX';"
echo ""
echo "2. Add SUPABASE_JWT_SECRET to your .env:"
echo "   - Find it in Supabase Dashboard > Settings > API"
echo "   - Copy the JWT Secret value"
echo "   - Add to .env: SUPABASE_JWT_SECRET=your-secret-here"
echo ""
echo "3. Test the token exchange:"
echo "   curl http://localhost:3000/api/auth/supabase-jwt"
echo ""
