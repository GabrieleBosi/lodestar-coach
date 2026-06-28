-- Core data model for Lodestar.
-- All tables use uuid primary keys and carry created_at / updated_at.
-- updated_at is maintained by a shared trigger.

-- ---------------------------------------------------------------------------
-- updated_at trigger helper
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles — one row per auth user (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  units text check (units in ('metric', 'imperial')) default 'metric',
  goals text,
  preferences jsonb not null default '{}'::jsonb,
  height_cm numeric,
  weight_kg numeric,
  age integer,
  sex text,
  activity_level text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- documents — source material (curated knowledge base entries)
-- ---------------------------------------------------------------------------
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  source_title text,
  source_url text,
  license text,
  summary text,
  added_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- chunks — embeddable fragments of documents (embeddings filled in Session 3)
-- ---------------------------------------------------------------------------
create table if not exists public.chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  content text not null,
  token_count integer,
  heading text,
  metadata jsonb not null default '{}'::jsonb,
  embedding vector(1536),
  content_hash text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- workouts — per-user training logs
-- ---------------------------------------------------------------------------
create table if not exists public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null default current_date,
  type text,
  payload jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- nutrition_logs — per-user nutrition logs
-- ---------------------------------------------------------------------------
create table if not exists public.nutrition_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null default current_date,
  payload jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- conversations — per-user chat threads (chat UI arrives in Session 4)
-- ---------------------------------------------------------------------------
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- messages — turns within a conversation; ownership flows from the parent
-- ---------------------------------------------------------------------------
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system', 'tool')),
  content text,
  citations jsonb,
  tool_calls jsonb,
  tokens_in integer,
  tokens_out integer,
  latency_ms integer,
  cost_usd numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- memories — per-user long-term memory, semantically searchable
-- ---------------------------------------------------------------------------
create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  content text not null,
  embedding vector(1536),
  kind text,
  salience real,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- traces — observability records for requests / pipeline stages
-- ---------------------------------------------------------------------------
create table if not exists public.traces (
  id uuid primary key default gen_random_uuid(),
  request_id text,
  user_id uuid references auth.users (id) on delete set null,
  stage text,
  payload jsonb,
  tokens integer,
  latency_ms integer,
  cost_usd numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- eval_runs — evaluation harness results (service-role only)
-- ---------------------------------------------------------------------------
create table if not exists public.eval_runs (
  id uuid primary key default gen_random_uuid(),
  commit_sha text,
  dataset text,
  metrics jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'documents', 'chunks', 'workouts', 'nutrition_logs',
    'conversations', 'messages', 'memories', 'traces', 'eval_runs'
  ]
  loop
    execute format('drop trigger if exists set_updated_at on public.%I;', t);
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function public.set_updated_at();', t
    );
  end loop;
end;
$$;
