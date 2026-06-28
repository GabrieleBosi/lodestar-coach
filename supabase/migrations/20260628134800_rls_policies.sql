-- Row-Level Security. Enabled on every table.
-- `auth.uid()` is wrapped in a subselect so the planner evaluates it once
-- per statement (Supabase RLS performance guidance).

-- Enable RLS everywhere.
alter table public.profiles enable row level security;
alter table public.documents enable row level security;
alter table public.chunks enable row level security;
alter table public.workouts enable row level security;
alter table public.nutrition_logs enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.memories enable row level security;
alter table public.traces enable row level security;
alter table public.eval_runs enable row level security;

-- ---------------------------------------------------------------------------
-- profiles — a user sees and edits only their own row
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert to authenticated with check (id = (select auth.uid()));

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Per-user CRUD tables (own rows via user_id)
-- ---------------------------------------------------------------------------
drop policy if exists workouts_crud_own on public.workouts;
create policy workouts_crud_own on public.workouts
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists nutrition_logs_crud_own on public.nutrition_logs;
create policy nutrition_logs_crud_own on public.nutrition_logs
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists conversations_crud_own on public.conversations;
create policy conversations_crud_own on public.conversations
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists memories_crud_own on public.memories;
create policy memories_crud_own on public.memories
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists traces_crud_own on public.traces;
create policy traces_crud_own on public.traces
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- messages — ownership scoped through the parent conversation
-- ---------------------------------------------------------------------------
drop policy if exists messages_crud_via_conversation on public.messages;
create policy messages_crud_via_conversation on public.messages
  for all to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- documents & chunks — readable by any authenticated user; writes are
-- service-role only (the service role bypasses RLS, so no write policy here)
-- ---------------------------------------------------------------------------
drop policy if exists documents_select_authenticated on public.documents;
create policy documents_select_authenticated on public.documents
  for select to authenticated using (true);

drop policy if exists chunks_select_authenticated on public.chunks;
create policy chunks_select_authenticated on public.chunks
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- eval_runs — no policies: only the service role can access it.
-- ---------------------------------------------------------------------------
