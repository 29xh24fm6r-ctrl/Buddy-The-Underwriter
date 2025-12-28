-- ==============================
-- SMS TIMELINE VERIFICATION QUERIES
-- ==============================

-- Check if you have any SMS outbound messages
\echo '=== Outbound SMS Messages ==='

select 
  deal_id,
  channel,
  to_value,
  status,
  provider_message_id,
  created_at
from public.outbound_messages
where channel = 'sms'
order by created_at desc
limit 10;

-- Check if you have any SMS inbound events
\echo ''
\echo '=== Inbound SMS Events ==='

select 
  deal_id,
  kind,
  metadata->>'from' as from_number,
  metadata->>'body' as message_body,
  created_at
from public.deal_events
where kind in ('sms_inbound', 'sms_reply', 'sms_status')
order by created_at desc
limit 10;

-- Count SMS events by type
\echo ''
\echo '=== SMS Event Counts ==='

select 
  'outbound' as type,
  count(*) as count
from public.outbound_messages
where channel = 'sms'

union all

select 
  kind as type,
  count(*) as count
from public.deal_events
where kind like 'sms%'
group by kind;

-- Get SMS timeline for a specific deal (replace :deal_id)
\echo ''
\echo '=== SMS Timeline for Deal ==='

-- Outbound messages for the deal
select 
  'outbound' as direction,
  created_at,
  to_value as phone,
  status,
  body
from public.outbound_messages
where deal_id = :deal_id
  and channel = 'sms'

union all

-- Inbound messages for the deal  
select 
  'inbound' as direction,
  created_at,
  metadata->>'from' as phone,
  'received' as status,
  metadata->>'body' as body
from public.deal_events
where deal_id = :deal_id
  and kind in ('sms_inbound', 'sms_reply')

order by created_at desc;

