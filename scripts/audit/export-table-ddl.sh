#!/usr/bin/env bash
# SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export.
#
# For every table classified DROP in docs/audit/schema-inventory-2026-07.md,
# dumps its schema-only DDL via pg_dump into docs/audit/dropped-ddl/<table>.sql.
# This is the restore path: if a C2 batch drops something that turns out to
# matter, `psql "$BUDDY_DB_URL" -f docs/audit/dropped-ddl/<table>.sql`
# recreates the empty table with its original shape (columns, defaults, PK/
# unique constraints, indexes — schema only, no data, since every DROP
# candidate here has zero rows per the inventory doc).
#
# Requires a real Postgres connection string (BUDDY_DB_URL or PG* env vars
# pg_dump understands) and network access to the database — neither is
# available in a sandboxed dev/CI environment, so this script is meant to be
# run by whoever has that access (Matt, or a CI job with the secret), not
# invoked automatically. The actual DDL files already committed under
# docs/audit/dropped-ddl/ were generated via an equivalent SQL
# reconstruction (information_schema-based, run through the same read-only
# SQL access used for the rest of this audit) — see that directory's
# README for the caveat on what it does and doesn't capture relative to a
# real pg_dump. Re-run this script for a byte-exact pg_dump version once
# you have DB network access, if you want one.
#
# Usage:
#   BUDDY_DB_URL='postgres://...' scripts/audit/export-table-ddl.sh [table ...]
# With no arguments, exports every DROP-classified table from the inventory
# doc.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INVENTORY_DOC="$ROOT/docs/audit/schema-inventory-2026-07.md"
OUT_DIR="$ROOT/docs/audit/dropped-ddl"

if [ -z "${BUDDY_DB_URL:-}" ]; then
  echo "ERROR: BUDDY_DB_URL is not set. This script needs a real Postgres" >&2
  echo "connection string with network access to the database." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

tables=("$@")
if [ ${#tables[@]} -eq 0 ]; then
  # Extract table names from **DROP**-classified rows in the inventory doc.
  mapfile -t tables < <(
    grep '\*\*DROP\*\*' "$INVENTORY_DOC" \
      | sed -E 's/^\| `([a-zA-Z0-9_]+)`.*/\1/' \
      | grep -v '^|'
  )
fi

echo "Exporting DDL for ${#tables[@]} table(s) to $OUT_DIR ..."

for t in "${tables[@]}"; do
  echo "  $t"
  pg_dump "$BUDDY_DB_URL" --schema-only --no-owner --no-privileges -t "public.$t" \
    > "$OUT_DIR/$t.sql"
done

echo "Done."
