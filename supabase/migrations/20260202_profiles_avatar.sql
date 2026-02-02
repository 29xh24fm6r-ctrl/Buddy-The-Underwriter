-- Add display_name and avatar fields to profiles table.
-- Idempotent: uses IF NOT EXISTS.
alter table public.profiles
  add column if not exists display_name text,
  add column if not exists avatar_url text,
  add column if not exists avatar_updated_at timestamptz;
