#!/usr/bin/env node
/**
 * Generate canonical tenant hardening SQL for a deal-scoped table.
 *
 * Usage examples:
 *   node scripts/generate-tenant-sql.mjs deal_mitigants
 *   node scripts/generate-tenant-sql.mjs deal_mitigants --schema public
 *   node scripts/generate-tenant-sql.mjs deal_mitigants --idCol deal_id --parent deals --parentIdCol id --parentTenantCol bank_id
 *
 * Output: runnable SQL (BEGIN/COMMIT) to:
 * - add bank_id if missing
 * - backfill from deals.bank_id using <table>.<deal_id> -> deals.id
 * - enforce NOT NULL
 * - add index
 *
 * NOTE: This generator does NOT create RLS policies; use your RLS rebuild script for that.
 */

const args = process.argv.slice(2);

function usage() {
  console.log(`
Usage:
  node scripts/generate-tenant-sql.mjs <table> [options]

Options:
  --schema <schema>           default: public
  --tenantCol <col>           default: bank_id
  --idCol <col>               default: deal_id
  --parent <table>            default: deals
  --parentSchema <schema>     default: public
  --parentIdCol <col>         default: id
  --parentTenantCol <col>     default: bank_id
  --index                     create index (default: true)
  --no-index                  do not create index

Examples:
  node scripts/generate-tenant-sql.mjs deal_mitigants
  node scripts/generate-tenant-sql.mjs deal_tasks --idCol deal_id
`);
  process.exit(1);
}

if (!args.length || args[0].startsWith("-")) usage();

const table = args[0];

const opts = {
  schema: "public",
  tenantCol: "bank_id",
  idCol: "deal_id",
  parent: "deals",
  parentSchema: "public",
  parentIdCol: "id",
  parentTenantCol: "bank_id",
  index: true,
};

for (let i = 1; i < args.length; i++) {
  const a = args[i];
  const next = args[i + 1];

  if (a === "--schema") {
    opts.schema = next;
    i++;
  } else if (a === "--tenantCol") {
    opts.tenantCol = next;
    i++;
  } else if (a === "--idCol") {
    opts.idCol = next;
    i++;
  } else if (a === "--parent") {
    opts.parent = next;
    i++;
  } else if (a === "--parentSchema") {
    opts.parentSchema = next;
    i++;
  } else if (a === "--parentIdCol") {
    opts.parentIdCol = next;
    i++;
  } else if (a === "--parentTenantCol") {
    opts.parentTenantCol = next;
    i++;
  } else if (a === "--index") {
    opts.index = true;
  } else if (a === "--no-index") {
    opts.index = false;
  } else {
    usage();
  }
}

function qIdent(x) {
  // Minimal identifier sanitation: allow letters/numbers/underscore only
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(x)) {
    throw new Error(`Invalid identifier: ${x}`);
  }
  return x;
}

const schema = qIdent(opts.schema);
const tenantCol = qIdent(opts.tenantCol);
const idCol = qIdent(opts.idCol);
const parentSchema = qIdent(opts.parentSchema);
const parent = qIdent(opts.parent);
const parentIdCol = qIdent(opts.parentIdCol);
const parentTenantCol = qIdent(opts.parentTenantCol);
const idxName = `${table}_${tenantCol}_idx`;

const fullTable = `${schema}.${qIdent(table)}`;
const fullParent = `${parentSchema}.${parent}`;

const sql = `
begin;

-- Canonical tenant hardening for ${fullTable}
-- - ensures ${tenantCol} exists
-- - backfills from ${fullParent}.${parentTenantCol} via ${idCol} -> ${parentIdCol}
-- - enforces NOT NULL
-- - adds index

alter table ${fullTable}
  add column if not exists ${tenantCol} uuid;

update ${fullTable} t
set ${tenantCol} = p.${parentTenantCol}
from ${fullParent} p
where p.${parentIdCol} = t.${idCol}
  and t.${tenantCol} is null;

do $$
declare n bigint;
begin
  select count(*) into n
  from ${fullTable}
  where ${tenantCol} is null;

  if n > 0 then
    raise exception '${fullTable}.${tenantCol} backfill incomplete: % rows still null. Verify ${fullTable}.${idCol} -> ${fullParent}.${parentIdCol} and ${fullParent}.${parentTenantCol}.', n;
  end if;
end $$;

alter table ${fullTable}
  alter column ${tenantCol} set not null;
${opts.index ? `
create index if not exists ${qIdent(idxName)}
  on ${fullTable}(${tenantCol});
` : ""}

commit;
`.trimStart();

console.log(sql);
