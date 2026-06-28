-- Vector search functions.
-- SECURITY INVOKER (the default) so they run as the caller and RLS applies.
-- search_path is pinned (not mutable) and includes `extensions` so the
-- `vector` type and `<=>` cosine-distance operator resolve.

-- match_chunks: nearest chunks across the (RLS-readable) knowledge base.
-- `filter` is matched against chunks.metadata via jsonb containment (@>);
-- the default '{}' matches everything.
create or replace function public.match_chunks(
  query_embedding vector(1536),
  match_count integer default 6,
  filter jsonb default '{}'::jsonb
)
returns table (
  id uuid,
  document_id uuid,
  content text,
  heading text,
  metadata jsonb,
  source_url text,
  similarity double precision
)
language sql
stable
security invoker
set search_path = extensions, public
as $$
  select
    c.id,
    c.document_id,
    c.content,
    c.heading,
    c.metadata,
    d.source_url,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.chunks c
  join public.documents d on d.id = c.document_id
  where c.embedding is not null
    and c.metadata @> filter
  order by c.embedding <=> query_embedding asc
  limit greatest(match_count, 0);
$$;

-- match_memories: the current user's nearest memories.
-- RLS already restricts memories to the owner; the explicit user_id filter
-- documents the intent and keeps the function correct under any caller.
create or replace function public.match_memories(
  query_embedding vector(1536),
  match_count integer default 5
)
returns table (
  id uuid,
  content text,
  kind text,
  salience real,
  similarity double precision
)
language sql
stable
security invoker
set search_path = extensions, public
as $$
  select
    m.id,
    m.content,
    m.kind,
    m.salience,
    1 - (m.embedding <=> query_embedding) as similarity
  from public.memories m
  where m.user_id = (select auth.uid())
    and m.embedding is not null
  order by m.embedding <=> query_embedding asc
  limit greatest(match_count, 0);
$$;
