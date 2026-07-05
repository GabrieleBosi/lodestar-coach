-- Response/embedding cache keyed by a hash of the normalized input (+ model).
-- Service-role only (RLS enabled, no policies) — it is shared infrastructure,
-- not user data.
create table if not exists public.llm_cache (
  key text primary key,
  kind text not null,
  model text,
  value jsonb not null,
  hits integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.llm_cache enable row level security;
