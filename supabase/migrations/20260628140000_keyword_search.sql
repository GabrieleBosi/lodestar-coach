-- Full-text keyword search over chunks, for hybrid retrieval (paired with the
-- vector match_chunks). GIN index on an english tsvector of the content, plus a
-- ranking function that mirrors match_chunks' shape.

create index if not exists chunks_content_fts
  on public.chunks using gin (to_tsvector('english', content));

-- match_chunks_keyword: lexical search via websearch_to_tsquery + ts_rank.
-- SECURITY INVOKER so RLS applies (chunks are readable by authenticated users).
create or replace function public.match_chunks_keyword(
  query_text text,
  match_count integer default 6
)
returns table (
  id uuid,
  document_id uuid,
  content text,
  heading text,
  metadata jsonb,
  source_url text,
  rank double precision
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    c.id,
    c.document_id,
    c.content,
    c.heading,
    c.metadata,
    d.source_url,
    ts_rank(to_tsvector('english', c.content), websearch_to_tsquery('english', query_text)) as rank
  from public.chunks c
  join public.documents d on d.id = c.document_id
  where websearch_to_tsquery('english', query_text) @@ to_tsvector('english', c.content)
  order by rank desc
  limit greatest(match_count, 0);
$$;
