-- Phase 53A: Deal Builder tables
-- Three additive tables. No existing tables modified.

-- 1. deal_builder_sections — section-keyed JSONB per deal
create table if not exists deal_builder_sections (
  id          uuid        primary key default gen_random_uuid(),
  deal_id     uuid        not null references deals(id) on delete cascade,
  section_key text        not null,
  data        jsonb       not null default '{}',
  completed   boolean     not null default false,
  updated_at  timestamptz not null default now(),
  unique(deal_id, section_key)
);

alter table deal_builder_sections enable row level security;

create policy "bank_scoped_builder_sections"
  on deal_builder_sections
  using (
    deal_id in (
      select id from deals
      where bank_id = (
        select bank_id from bank_users
        where user_id = auth.uid()
        limit 1
      )
    )
  );

create index idx_deal_builder_sections_deal_id
  on deal_builder_sections(deal_id);

-- 2. deal_collateral_items — one row per collateral item
create table if not exists deal_collateral_items (
  id               uuid        primary key default gen_random_uuid(),
  deal_id          uuid        not null references deals(id) on delete cascade,
  item_type        text        not null,
  description      text,
  estimated_value  numeric,
  lien_position    integer     not null default 1,
  appraisal_date   date,
  address          text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table deal_collateral_items enable row level security;

create policy "bank_scoped_collateral"
  on deal_collateral_items
  using (
    deal_id in (
      select id from deals
      where bank_id = (
        select bank_id from bank_users
        where user_id = auth.uid()
        limit 1
      )
    )
  );

create index idx_deal_collateral_items_deal_id
  on deal_collateral_items(deal_id);

-- 3. deal_proceeds_items — one row per use-of-proceeds line
create table if not exists deal_proceeds_items (
  id          uuid        primary key default gen_random_uuid(),
  deal_id     uuid        not null references deals(id) on delete cascade,
  category    text        not null,
  description text,
  amount      numeric     not null,
  created_at  timestamptz not null default now()
);

alter table deal_proceeds_items enable row level security;

create policy "bank_scoped_proceeds"
  on deal_proceeds_items
  using (
    deal_id in (
      select id from deals
      where bank_id = (
        select bank_id from bank_users
        where user_id = auth.uid()
        limit 1
      )
    )
  );

create index idx_deal_proceeds_items_deal_id
  on deal_proceeds_items(deal_id);
