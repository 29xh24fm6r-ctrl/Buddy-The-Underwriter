# SQL Generator for Tenant Hardening

## Purpose

This script generates **runnable SQL** for adding tenant isolation (`bank_id`) to deal-scoped tables. No more template placeholders like `<TABLE>` or `##COLUMN##` that break when copy/pasted.

## Usage

```bash
npm run gen:tenant-sql -- <table_name> [options]
```

### Examples

**Basic usage** (deal-scoped table):
```bash
npm run gen:tenant-sql -- deal_mitigants
```

**Custom ID column**:
```bash
npm run gen:tenant-sql -- deal_tasks --idCol task_deal_id
```

**No index**:
```bash
npm run gen:tenant-sql -- deal_notes --no-index
```

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `--schema` | `public` | Schema of the table |
| `--tenantCol` | `bank_id` | Name of the tenant column to add |
| `--idCol` | `deal_id` | Foreign key column pointing to parent |
| `--parent` | `deals` | Parent table name |
| `--parentSchema` | `public` | Schema of parent table |
| `--parentIdCol` | `id` | Primary key column of parent |
| `--parentTenantCol` | `bank_id` | Tenant column in parent |
| `--index` | `true` | Create index on tenant column |
| `--no-index` | - | Skip index creation |

## Output

Generates complete SQL that:
1. Adds `bank_id` column if missing
2. Backfills from parent table (e.g., `deals.bank_id`)
3. Validates backfill (fails if any NULLs remain)
4. Enforces NOT NULL constraint
5. Creates index (optional)

## Workflow

1. **Generate SQL**:
   ```bash
   npm run gen:tenant-sql -- deal_mitigants > temp.sql
   ```

2. **Review output**:
   ```bash
   cat temp.sql
   ```

3. **Run in Supabase SQL Editor** (role: postgres):
   - Copy/paste the output
   - Execute

4. **Clean up**:
   ```bash
   rm temp.sql
   ```

## Example Output

```sql
begin;

-- Canonical tenant hardening for public.deal_mitigants
-- - ensures bank_id exists
-- - backfills from public.deals.bank_id via deal_id -> id
-- - enforces NOT NULL
-- - adds index

alter table public.deal_mitigants
  add column if not exists bank_id uuid;

update public.deal_mitigants t
set bank_id = p.bank_id
from public.deals p
where p.id = t.deal_id
  and t.bank_id is null;

do $$
declare n bigint;
begin
  select count(*) into n
  from public.deal_mitigants
  where bank_id is null;

  if n > 0 then
    raise exception 'public.deal_mitigants.bank_id backfill incomplete: % rows still null. Verify public.deal_mitigants.deal_id -> public.deals.id and public.deals.bank_id.', n;
  end if;
end $$;

alter table public.deal_mitigants
  alter column bank_id set not null;

create index if not exists deal_mitigants_bank_id_idx
  on public.deal_mitigants(bank_id);

commit;
```

## Best Practices

✅ **Always review generated SQL before running**  
✅ **Test on dev environment first**  
✅ **Run RLS rebuild after hardening tables**  
❌ **Never save template SQL with `<TABLE>` placeholders**  
❌ **Never run unreviewed generated SQL in production**  

## Integration with Guards

After hardening a table:
1. Run this generator
2. Execute SQL in Supabase
3. Run RLS rebuild: `/scripts/rebuild-rls.sql` (if exists)
4. Update guards to include new table (if needed)

## Troubleshooting

**"backfill incomplete" error**:
- Check foreign key exists: `deal_id` → `deals.id`
- Check parent has tenant column: `deals.bank_id IS NOT NULL`
- Verify orphaned rows (deal_id not in deals)

**Index already exists**:
- Use `--no-index` flag
- Or drop existing index first

**Column already exists**:
- Safe to re-run (uses `ADD COLUMN IF NOT EXISTS`)
- Won't lose existing data
