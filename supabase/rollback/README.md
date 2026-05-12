# Supabase rollback migrations

Files in this directory are **not** applied automatically by the migration
runner. They mirror the matching forward migration in
`supabase/migrations/` and are run manually by ops when a rollback is
needed.

Naming convention: `<same-timestamp-as-forward>_<name>_inverse.sql`.

Each forward migration that ships with a documented inverse should have
its inverse co-located here on the same PR.
