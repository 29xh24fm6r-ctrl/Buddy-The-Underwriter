#!/bin/bash
# Run the buddy_intel_events migration
# This creates the intelligence events table for Command Bridge V3

echo "🚀 Running buddy_intel_events migration..."

if [ -z "$DATABASE_URL" ]; then
  echo "❌ ERROR: DATABASE_URL environment variable not set"
  exit 1
fi

# Check if psql is available
if ! command -v psql &> /dev/null; then
  echo "❌ ERROR: psql command not found"
  echo "💡 Please run this migration manually in Supabase dashboard:"
  echo "   1. Go to your Supabase project"
  echo "   2. Navigate to SQL Editor"
  echo "   3. Copy/paste the contents of: supabase/migrations/20251220_buddy_intel_events.sql"
  echo "   4. Click 'Run'"
  exit 1
fi

psql "$DATABASE_URL" -f supabase/migrations/20251220_buddy_intel_events.sql

if [ $? -eq 0 ]; then
  echo "✅ Migration completed successfully!"
  echo "   Table created: buddy_intel_events"
  echo "   Indexes created: 4 indexes"
  echo "   RLS enabled with read policy"
else
  echo "❌ Migration failed"
  exit 1
fi
