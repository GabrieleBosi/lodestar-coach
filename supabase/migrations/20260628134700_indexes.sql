-- Indexes: HNSW for vector similarity, B-tree for foreign keys and hot lookups.

-- Vector similarity (cosine) — HNSW handles empty tables fine.
create index if not exists chunks_embedding_hnsw
  on public.chunks using hnsw (embedding vector_cosine_ops);

create index if not exists memories_embedding_hnsw
  on public.memories using hnsw (embedding vector_cosine_ops);

-- Foreign keys.
create index if not exists chunks_document_id_idx on public.chunks (document_id);
create index if not exists documents_added_by_idx on public.documents (added_by);
create index if not exists messages_conversation_id_idx on public.messages (conversation_id);
create index if not exists conversations_user_id_idx on public.conversations (user_id);
create index if not exists memories_user_id_idx on public.memories (user_id);
create index if not exists traces_user_id_idx on public.traces (user_id);

-- (user_id, date) lookups for time-series reads.
create index if not exists workouts_user_id_date_idx on public.workouts (user_id, date);
create index if not exists nutrition_logs_user_id_date_idx on public.nutrition_logs (user_id, date);
