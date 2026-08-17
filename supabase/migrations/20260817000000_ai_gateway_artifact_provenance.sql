alter table public.ai_gateway_calls
  add column if not exists trace_id uuid,
  add column if not exists artifact_type text,
  add column if not exists artifact_id uuid;

create index if not exists ai_gateway_calls_trace_id_idx
  on public.ai_gateway_calls (trace_id, created_at desc)
  where trace_id is not null;

create index if not exists ai_gateway_calls_artifact_idx
  on public.ai_gateway_calls (artifact_type, artifact_id, created_at desc)
  where artifact_id is not null;

comment on column public.ai_gateway_calls.trace_id is
  'Orchestrator-level trace id (for Golden Trident, the bundle id) shared by every nested provider attempt.';
comment on column public.ai_gateway_calls.artifact_type is
  'Stable artifact family that caused the provider call.';
comment on column public.ai_gateway_calls.artifact_id is
  'Persisted artifact/orchestrator row id associated with the provider call.';
